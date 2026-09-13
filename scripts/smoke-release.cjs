'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { extractRelease } = require('../deploy/archive.cjs');
const { newCredentials } = require('../backend/src/management/auth-store.cjs');
const { atomicJson, assertTag } = require('../backend/src/management/contract.cjs');

async function smoke() {
    const tag = assertTag(process.env.RELEASE_TAG);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-smoke-'));
    const release = path.join(temporary, 'release');
    extractRelease(fs.readFileSync(path.join(__dirname, `../out/sub-store-server-${tag}.tar.gz`)), release, tag);
    const dataDirectory = path.join(temporary, 'data');
    fs.mkdirSync(dataDirectory);
    const { credentials, secrets } = await newCredentials();
    atomicJson(path.join(temporary, 'auth.json'), credentials);
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    let child;
    let logs = '';
    const environment = {
        ...process.env, NODE_ENV: 'production', SUB_STORE_BACKEND_API_HOST: '127.0.0.1', SUB_STORE_BACKEND_API_PORT: String(port),
        SUB_STORE_BACKEND_MERGE: 'ON', SUB_STORE_FRONTEND_BACKEND_PATH: '/', SUB_STORE_FRONTEND_PATH: path.join(release, 'frontend'),
        SUB_STORE_DATA_BASE_PATH: dataDirectory, SUB_STORE_AUTH_ENABLED: 'true', SUB_STORE_AUTH_FILE: path.join(temporary, 'auth.json'),
        SUB_STORE_AUTH_SESSIONS_FILE: path.join(temporary, 'sessions.json'), SUB_STORE_PUBLIC_ORIGIN: 'https://smoke.invalid',
        SUB_STORE_CORS_ALLOWED_ORIGINS: 'https://smoke.invalid', SUB_STORE_RELEASE_MANIFEST: path.join(release, 'release-manifest.json'),
        SUB_STORE_ONLINE_MANAGEMENT: 'false',
    };
    async function start() {
        child = spawn(process.execPath, [path.join(release, 'backend/dist/sub-store.bundle.js')], { cwd: dataDirectory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', bytes => { logs += bytes; });
        child.stderr.on('data', bytes => { logs += bytes; });
        for (let attempt = 0; attempt < 80; attempt++) {
            if (child.exitCode !== null) throw new Error(`Release process exited with code ${child.exitCode}`);
            try {
                const response = await fetch(`${base}/api/health`);
                const body = await response.json();
                if (body.data?.projectVersion === tag && body.data?.authEnabled === true) return;
            } catch { /* wait for startup */ }
            await delay(250);
        }
        throw new Error('Release startup timed out');
    }
    async function stop() {
        if (!child || child.exitCode !== null) return;
        const stopped = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        await stopped;
    }
    const bearer = { Authorization: `Bearer ${secrets.apiToken}` };
    const json = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    try {
        await start();
        for (const endpoint of ['/api/subs', '/api/storage', '/api/settings', '/api/utils/env', '/download/test']) {
            assert.equal((await fetch(base + endpoint)).status, 401, `Anonymous ${endpoint} must be blocked`);
        }
        assert.equal((await fetch(`${base}/`)).status, 200);
        const login = await fetch(`${base}/api/auth/login`, json({ username: 'admin', password: secrets.password }));
        assert.equal(login.status, 200, 'Login must succeed');
        const setCookie = login.headers.get('set-cookie');
        assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('Secure') && setCookie.includes('SameSite=Strict') && setCookie.includes('Max-Age=2592000'), 'Cookie flags and 30-day TTL');
        const cookie = setCookie.split(';')[0];
        const loginData = (await login.json()).data;
        const sessionHeaders = { Cookie: cookie, 'X-CSRF-Token': loginData.csrfToken };
        assert.equal((await fetch(`${base}/api/subs`, { headers: sessionHeaders })).status, 200);
        assert.equal((await fetch(`${base}/api/utils/refresh`, { headers: { Cookie: cookie } })).status, 403);
        assert.equal((await fetch(`${base}/api/subs?token=${secrets.apiToken}`)).status, 401);
        assert.equal((await fetch(`${base}/api/subs`, { headers: bearer })).status, 200);
        const subscription = { name: 'smoke', source: 'local', content: `ss://${Buffer.from('aes-128-gcm:synthetic-pass').toString('base64')}@127.0.0.1:8388#Smoke` };
        const created = await fetch(`${base}/api/subs`, json(subscription, bearer));
        assert.ok(created.ok, 'Synthetic subscription must be accepted');
        const signed = await fetch(`${base}/api/token`, json({ payload: { type: 'sub', name: 'smoke' } }, bearer));
        assert.ok(signed.ok, 'Share token must be created');
        const token = (await signed.json()).data.token;
        assert.equal((await fetch(`${base}/share/sub/smoke?token=${encodeURIComponent(token)}&target=ClashMeta`)).status, 200, 'Independent share token must work');
        assert.notEqual((await fetch(`${base}/share/sub/smoke?token=invalid`)).status, 200);
        assert.equal((await fetch(`${base}/api/subs?token=${encodeURIComponent(token)}`)).status, 401);
        const exported = await (await fetch(`${base}/api/storage`, { headers: bearer })).text();
        const env = await (await fetch(`${base}/api/utils/env`, { headers: bearer })).text();
        for (const text of [exported, env, logs]) {
            assert.ok(!text.includes(secrets.password) && !text.includes(secrets.apiToken) && !text.includes(credentials.apiTokenHash), 'Authentication secrets must stay private');
        }
        assert.ok(!env.includes('SUB_STORE_AUTH_') && !exported.includes('sessionEpoch'));
        await stop(); await start();
        assert.equal((await fetch(`${base}/api/subs`, { headers: sessionHeaders })).status, 200, 'Session survives restart');
        assert.equal((await fetch(`${base}/api/auth/logout`, json({}, sessionHeaders))).status, 200);
        assert.equal((await fetch(`${base}/api/subs`, { headers: sessionHeaders })).status, 401, 'Logout invalidates the session');
        console.log(`Release ${tag}: startup, auth, CSRF, exports, shares and restart checks passed`);
    } finally {
        await stop();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}
smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
