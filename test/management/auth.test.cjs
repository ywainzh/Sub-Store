'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('../../backend/node_modules/express');
const { registerAuth } = require('../../backend/src/management/auth.cjs');
const { newCredentials, resolveAuthConfig, SESSION_TTL } = require('../../backend/src/management/auth-store.cjs');
const { atomicJson } = require('../../backend/src/management/contract.cjs');

async function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-auth-test-'));
    const { credentials, secrets } = await newCredentials();
    atomicJson(path.join(root, 'auth.json'), credentials);
    let now = Date.now();
    const env = {
        NODE_ENV: 'production', SUB_STORE_AUTH_ENABLED: 'true', SUB_STORE_AUTH_FILE: path.join(root, 'auth.json'),
        SUB_STORE_AUTH_SESSIONS_FILE: path.join(root, 'sessions.json'), SUB_STORE_DATA_BASE_PATH: path.join(root, 'data'),
        SUB_STORE_PUBLIC_ORIGIN: 'https://sub.example.com',
    };
    const app = express(); app.use(express.json());
    registerAuth(app, { env, now: () => now });
    app.get('/api/subs', (req, res) => res.json({ status: 'success' }));
    app.get('/api/request-headers', (req, res) => res.json(req.headers));
    app.get('/api/utils/refresh', (req, res) => res.json({ status: 'success' }));
    app.post('/api/subs', (req, res) => res.json({ status: 'success' }));
    app.get('/api/health', (req, res) => res.json({ ready: true }));
    app.get('/download/demo', (req, res) => res.send('demo'));
    app.get('/share/sub/demo', (req, res) => res.status(req.query.token === 'independent-share-token' ? 200 : 403).end());
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
    const request = (endpoint, init = {}) => fetch(base + endpoint, init);
    const login = async (password = secrets.password, extra = {}) => request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ username: 'admin', password }),
    });
    const session = async () => {
        const response = await login();
        assert.equal(response.status, 200);
        const cookie = response.headers.get('set-cookie').split(';')[0];
        const data = (await response.json()).data;
        return { cookie, data, headers: { Cookie: cookie, 'X-CSRF-Token': data.csrfToken } };
    };
    return { root, credentials, secrets, env, request, login, session, advance: time => { now += time; } };
}

test('production cannot start without valid auth configuration', async t => {
    assert.throws(() => resolveAuthConfig({ NODE_ENV: 'production' }), /PRODUCTION_REQUIRES_AUTH/);
    const f = await fixture(t);
    assert.throws(() => registerAuth(express(), { env: { ...f.env, SUB_STORE_AUTH_FILE: path.join(f.root, 'missing') } }));
    assert.throws(() => resolveAuthConfig({ ...f.env, SUB_STORE_AUTH_FILE: path.join(f.root, 'data/auth.json') }), /OUTSIDE_DATA/);
    assert.throws(() => resolveAuthConfig({ ...f.env, SUB_STORE_PUBLIC_ORIGIN: 'http://sub.example.com' }), /INVALID_PUBLIC_ORIGIN/);
    fs.writeFileSync(path.join(f.root, 'auth.json'), '{}');
    assert.throws(() => registerAuth(express(), { env: f.env }), /INVALID_AUTH_CREDENTIALS/);
});

test('anonymous management is blocked, health and independent share validation remain available', async t => {
    const f = await fixture(t);
    for (const endpoint of ['/api/subs', '/api/storage', '/api/utils/refresh', '/download/demo', '/API/subs']) {
        assert.equal((await f.request(endpoint)).status, 401);
    }
    assert.equal((await f.request('/api/subs', { method: 'POST' })).status, 401);
    assert.equal((await f.request('/api/health')).status, 200);
    assert.equal((await f.request('/share/sub/demo?token=independent-share-token')).status, 200);
    assert.equal((await f.request('/share/sub/demo?token=wrong')).status, 403);
    assert.equal((await f.request('/api/subs?token=independent-share-token')).status, 401);
    assert.equal((await f.request('/api/subs', { headers: { Authorization: `Bearer ${f.secrets.apiToken}` } })).status, 200);
    assert.equal((await f.request('/api/subs', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
});

test('session cookie has a fixed 30-day lifetime and CSRF protects GET actions and writes', async t => {
    const f = await fixture(t);
    const response = await f.login();
    const cookieHeader = response.headers.get('set-cookie');
    assert.ok(/HttpOnly/.test(cookieHeader) && /Secure/.test(cookieHeader) && /SameSite=Strict/.test(cookieHeader) && /Max-Age=2592000/.test(cookieHeader));
    const { headers, cookie } = await f.session();
    for (const [endpoint, method] of [['/api/subs', 'POST'], ['/api/utils/refresh', 'GET']]) {
        assert.equal((await f.request(endpoint, { method, headers: { Cookie: cookie } })).status, 403);
        assert.equal((await f.request(endpoint, { method, headers })).status, 200);
        assert.equal((await f.request(endpoint, { method, headers: { ...headers, Origin: 'https://evil.example.com' } })).status, 403);
    }
    assert.equal((await f.request('/api/auth/status', { headers: { Cookie: cookie, Origin: 'https://evil.example.com' } })).status, 403);
    f.advance(SESSION_TTL - 1);
    assert.equal((await f.request('/api/subs', { headers })).status, 200);
    f.advance(1);
    assert.equal((await f.request('/api/subs', { headers })).status, 401);
});

test('logout and password reset revoke sessions; API token rotation is independent', async t => {
    const f = await fixture(t);
    const first = await f.session(); const second = await f.session();
    assert.equal((await f.request('/api/auth/logout', { method: 'POST', headers: first.headers })).status, 200);
    assert.equal((await f.request('/api/subs', { headers: first.headers })).status, 401);
    assert.equal((await f.request('/api/subs', { headers: second.headers })).status, 200);
    atomicJson(path.join(f.root, 'auth.json'), { ...f.credentials, sessionEpoch: 'f'.repeat(32) });
    assert.equal((await f.request('/api/subs', { headers: second.headers })).status, 401);
    assert.equal((await f.request('/api/subs', { headers: { Authorization: `Bearer ${f.secrets.apiToken}` } })).status, 200);
    const active = await f.session();
    atomicJson(path.join(f.root, 'auth.json'), { ...f.credentials, sessionEpoch: 'f'.repeat(32), apiTokenHash: 'a'.repeat(64) });
    assert.equal((await f.request('/api/subs', { headers: { Authorization: `Bearer ${f.secrets.apiToken}` } })).status, 401);
    assert.equal((await f.request('/api/subs', { headers: active.headers })).status, 200);
});

test('login rejects cross-origin submissions and rate limits failures', async t => {
    const f = await fixture(t);
    assert.equal((await f.login(f.secrets.password, { Origin: 'https://evil.example.com' })).status, 403);
    for (let attempt = 0; attempt < 10; attempt++) assert.equal((await f.login('invalid-password')).status, 401);
    const limited = await f.login();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    f.advance(15 * 60 * 1000);
    assert.equal((await f.login()).status, 200);
});

test('management credentials never reach existing request processors', async t => {
    const f = await fixture(t);
    const { headers } = await f.session();
    for (const supplied of [headers, { Authorization: `Bearer ${f.secrets.apiToken}` }]) {
        const visible = await (await f.request('/api/request-headers', { headers: supplied })).json();
        assert.equal(visible.authorization, undefined); assert.equal(visible.cookie, undefined); assert.equal(visible['x-csrf-token'], undefined);
    }
    const status = await (await f.request('/api/auth/status', { headers: { Authorization: `Bearer ${f.secrets.apiToken}` } })).json();
    assert.equal(status.data.authenticated, true); assert.equal(status.data.csrfToken, null);
});
