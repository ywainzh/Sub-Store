'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
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
    let providerFlow = 'upload=10; download=20; total=100; expire=4115721600';
    let providerRequests = 0;
    const provider = http.createServer((req, res) => {
        providerRequests++;
        if (providerFlow) res.setHeader('subscription-userinfo', providerFlow);
        res.end(`ss://${Buffer.from('aes-128-gcm:synthetic-pass').toString('base64')}@127.0.0.1:8389#Smoke-Remote`);
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    const providerUrl = `http://127.0.0.1:${provider.address().port}/subscription`;
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
        for (const endpoint of ['/api/subs', '/api/subs/status', '/api/storage', '/api/settings', '/api/utils/env', '/download/test']) {
            assert.equal((await fetch(base + endpoint)).status, 401, `Anonymous ${endpoint} must be blocked`);
        }
        assert.equal((await fetch(`${base}/api/sub/smoke/check`, json({}))).status, 401);
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
        assert.equal((await fetch(`${base}/api/sub/smoke/check`, json({}, { Cookie: cookie }))).status, 403, 'Checks require CSRF for browser sessions');
        assert.equal((await fetch(`${base}/api/sub/smoke`, { ...json({ enabled: false }, { Cookie: cookie }), method: 'PATCH' })).status, 403, 'Switches require CSRF for browser sessions');
        assert.equal((await fetch(`${base}/api/subs/status`, { headers: sessionHeaders })).status, 200);
        const signed = await fetch(`${base}/api/token`, json({ payload: { type: 'sub', name: 'smoke' } }, bearer));
        assert.ok(signed.ok, 'Share token must be created');
        const token = (await signed.json()).data.token;
        assert.equal((await fetch(`${base}/share/sub/smoke?token=${encodeURIComponent(token)}&target=ClashMeta`)).status, 200, 'Independent share token must work');
        assert.notEqual((await fetch(`${base}/share/sub/smoke?token=invalid`)).status, 200);
        assert.equal((await fetch(`${base}/api/subs?token=${encodeURIComponent(token)}`)).status, 401);

        const patch = async (type, name, body) => {
            const response = await fetch(`${base}/api/${type}/${name}`, { ...json(body, bearer), method: 'PATCH' });
            assert.equal(response.status, 200);
        };
        const statuses = async () => {
            const response = await fetch(`${base}/api/subs/status`, { headers: bearer });
            assert.equal(response.status, 200);
            return (await response.json()).data;
        };
        const checkRemote = async () => {
            const response = await fetch(`${base}/api/sub/smoke-remote/check`, json({}, bearer));
            assert.equal(response.status, 200);
            return (await response.json()).data;
        };
        assert.ok((await fetch(`${base}/api/subs`, json({ ...subscription, name: 'smoke-b', content: subscription.content.replace('#Smoke', '#Smoke-B') }, bearer))).ok);
        assert.ok((await fetch(`${base}/api/subs`, json({ name: 'smoke-remote', source: 'remote', url: providerUrl }, bearer))).ok);
        assert.ok((await fetch(`${base}/api/collections`, json({ name: 'smoke-group', subscriptions: ['smoke', 'smoke-b', 'smoke-remote'] }, bearer))).ok);
        const groupTokenResponse = await fetch(`${base}/api/token`, json({ payload: { type: 'col', name: 'smoke-group' } }, bearer));
        assert.ok(groupTokenResponse.ok);
        const groupToken = (await groupTokenResponse.json()).data.token;
        const groupUrl = `${base}/share/col/smoke-group?token=${encodeURIComponent(groupToken)}&target=JSON&noFlow=true`;
        const groupNodes = async () => {
            const response = await fetch(groupUrl);
            assert.equal(response.status, 200, 'The original collection share stays usable');
            return (await response.json()).map(node => node.name);
        };
        await checkRemote();
        assert.deepEqual(await groupNodes(), ['Smoke', 'Smoke-B', 'Smoke-Remote']);
        await patch('sub', 'smoke', { enabled: false });
        for (const url of [
            `${base}/share/sub/smoke?token=${encodeURIComponent(token)}&target=JSON&noFlow=true`,
            `${base}/download/smoke?target=JSON&produceType=raw&noFlow=true&ignoreFailedRemoteSub=fallbackQuiet`,
        ]) assert.equal((await fetch(url, { headers: bearer })).status, 409, 'Disabled downloads cannot bypass the switch');
        assert.deepEqual(await groupNodes(), ['Smoke-B', 'Smoke-Remote']);
        providerFlow = 'upload=20; download=80; total=100; expire=4115721600';
        assert.equal((await checkRemote()).reason, 'exhausted');
        providerFlow = '';
        assert.equal((await checkRemote()).reason, 'exhausted', 'Missing metadata does not restore a confirmed exhausted subscription');
        const requestsBeforeStatus = providerRequests;
        const stopped = await statuses();
        await statuses();
        assert.equal(providerRequests, requestsBeforeStatus, 'Status reads do not contact providers');
        assert.equal(stopped.subscriptions.find(item => item.name === 'smoke').reason, 'manual');
        assert.deepEqual(await groupNodes(), ['Smoke-B']);
        await patch('collection', 'smoke-group', { enabled: false });
        assert.equal((await fetch(groupUrl)).status, 409);
        await patch('collection', 'smoke-group', { enabled: true });
        const exported = await (await fetch(`${base}/api/storage`, { headers: bearer })).text();
        const env = await (await fetch(`${base}/api/utils/env`, { headers: bearer })).text();
        for (const text of [exported, env, logs]) {
            assert.ok(!text.includes(secrets.password) && !text.includes(secrets.apiToken) && !text.includes(credentials.apiTokenHash), 'Authentication secrets must stay private');
        }
        assert.ok(!env.includes('SUB_STORE_AUTH_') && !exported.includes('sessionEpoch'));
        await stop(); await start();
        assert.equal((await fetch(`${base}/api/subs`, { headers: sessionHeaders })).status, 200, 'Session survives restart');
        const restarted = await statuses();
        assert.equal(restarted.subscriptions.find(item => item.name === 'smoke').reason, 'manual');
        assert.equal(restarted.subscriptions.find(item => item.name === 'smoke-remote').reason, 'exhausted');
        assert.deepEqual(await groupNodes(), ['Smoke-B']);
        await patch('sub', 'smoke', { enabled: true });
        assert.equal((await fetch(`${base}/share/sub/smoke?token=${encodeURIComponent(token)}&target=JSON`)).status, 200, 'Re-enabling restores the original share link');
        providerFlow = 'upload=10; download=20; total=100; expire=1';
        assert.equal((await checkRemote()).reason, 'expired');
        providerFlow = 'upload=10; download=20; total=100; expire=4115721600';
        assert.equal((await checkRemote()).active, true, 'A confirmed renewal restores an automatically stopped subscription');
        assert.deepEqual(await groupNodes(), ['Smoke', 'Smoke-B', 'Smoke-Remote']);
        const imported = JSON.parse(await (await fetch(`${base}/api/storage`, { headers: bearer })).text());
        imported.subs.reverse();
        imported.subs[0].active = false;
        imported.subs[0].reason = 'manual';
        assert.equal((await fetch(`${base}/api/storage`, json({ content: JSON.stringify(imported) }, bearer))).status, 200);
        const afterImport = await statuses();
        assert.ok(afterImport.subscriptions.every(item => item.active), 'Import order does not change availability and runtime fields cannot be injected');
        const savedSubs = (await (await fetch(`${base}/api/subs`, { headers: bearer })).json()).data;
        assert.ok(savedSubs.every(item => !Object.hasOwn(item, 'active') && !Object.hasOwn(item, 'reason')));
        assert.equal((await fetch(`${base}/api/auth/logout`, json({}, sessionHeaders))).status, 200);
        assert.equal((await fetch(`${base}/api/subs`, { headers: sessionHeaders })).status, 401, 'Logout invalidates the session');
        console.log(`Release ${tag}: startup, auth, CSRF, exports, availability, recovery, original shares, import and restart checks passed`);
    } finally {
        await stop();
        await new Promise(resolve => provider.close(resolve));
        const resolved = path.resolve(temporary);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('sub-store-smoke-')) throw new Error('Unexpected smoke directory');
        fs.rmSync(resolved, { recursive: true, force: true });
    }
}
smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
