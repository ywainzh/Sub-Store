'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('../../backend/node_modules/express');
const { registerManagement } = require('../../backend/src/management/index.cjs');
const { newCredentials } = require('../../backend/src/management/auth-store.cjs');
const { atomicJson, readJson } = require('../../backend/src/management/contract.cjs');

const manifest = tag => ({ formatVersion: 1, repository: 'ywainzh/Sub-Store', tag, commit: 'a'.repeat(40),
    versions: { backend: '2.39.6', frontend: '2.32.2' }, testedNode: '24.15.0', compatibility: { management: 1, auth: 1, data: { read: ['2.0'], write: '2.0' } } });
async function fixture(t, offline = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-controller-test-'));
    for (const name of ['data', 'state', 'inbox', 'releases/v0.1.0']) fs.mkdirSync(path.join(root, name), { recursive: true });
    const { credentials, secrets } = await newCredentials();
    atomicJson(path.join(root, 'auth.json'), credentials);
    atomicJson(path.join(root, 'data/sub-store.json'), { schemaVersion: '2.0' });
    atomicJson(path.join(root, 'releases/v0.1.0/release-manifest.json'), manifest('v0.1.0'));
    atomicJson(path.join(root, 'state/installation.json'), { current: 'v0.2.0', previous: 'v0.1.0', snapshot: { tag: 'v0.1.0', dataSchema: '2.0' } });
    const app = express(); app.use(express.json());
    registerManagement(app, {
        env: { NODE_ENV: 'production', SUB_STORE_AUTH_ENABLED: 'true', SUB_STORE_AUTH_FILE: path.join(root, 'auth.json'),
            SUB_STORE_AUTH_SESSIONS_FILE: path.join(root, 'sessions.json'), SUB_STORE_DATA_BASE_PATH: path.join(root, 'data'),
            SUB_STORE_PUBLIC_ORIGIN: 'https://test.example.com', SUB_STORE_ONLINE_MANAGEMENT: 'true',
            SUB_STORE_DEPLOY_DIRECTORY: root, SUB_STORE_RELEASES_DIRECTORY: path.join(root, 'releases'),
        },
        manifest: manifest('v0.2.0'),
        catalog: {
            list: async page => { if (offline) throw new Error('RELEASE_HTTP_503'); return { versions: [{ tag: 'v0.3.0', manifest: manifest('v0.3.0'), notes: 'new version' }], nextPage: page === 1 ? 2 : null }; },
            get: async tag => { if (tag === 'v0.0.1') throw new Error('INCOMPATIBLE_RELEASE_MANIFEST'); await new Promise(resolve => setImmediate(resolve)); return { tag, manifest: manifest(tag) }; },
        },
    });
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
    const request = (endpoint, body) => fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${secrets.apiToken}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { root, request };
}

test('versions are paginated, label the local previous release and keep it available offline', async t => {
    const f = await fixture(t);
    const first = (await (await f.request('/api/system/versions')).json()).data;
    assert.equal(first.current, 'v0.2.0'); assert.equal(first.latest, 'v0.3.0'); assert.equal(first.nextPage, 2);
    assert.equal(first.versions.find(version => version.tag === 'v0.1.0').local, true);
    assert.equal(first.versions.find(version => version.tag === 'v0.1.0').canRestoreData, true);
    assert.equal((await f.request('/api/system/versions?page=-1')).status, 400);
    const offline = await fixture(t, true);
    const result = (await (await offline.request('/api/system/versions')).json()).data;
    assert.ok(result.remoteError); assert.deepEqual(result.versions.map(version => version.tag), ['v0.1.0']);
});

test('concurrent deployment clicks admit exactly one complete request and status survives a refresh', async t => {
    const f = await fixture(t);
    const results = await Promise.all([f.request('/api/system/deployments', { tag: 'v0.3.0' }), f.request('/api/system/deployments', { tag: 'v0.3.0' })]);
    assert.deepEqual(results.map(result => result.status).sort(), [202, 409]);
    const request = readJson(path.join(f.root, 'inbox/request.json'));
    assert.equal(request.tag, 'v0.3.0'); assert.equal(request.restoreData, false);
    const status = (await (await f.request(`/api/system/deployments/${request.id}`)).json()).data;
    assert.equal(status.phase, 'queued'); assert.equal(status.id, request.id);
    const refreshed = (await (await f.request('/api/system/versions')).json()).data;
    assert.equal(refreshed.activeDeployment.id, request.id);
});

test('deployment API rejects commands, arbitrary URLs, malformed tags, incompatible legacy and unmatched data restore', async t => {
    const f = await fixture(t);
    for (const body of [
        { tag: '../../etc' }, { tag: 'v0.3.0; id' }, { tag: 'v0.3.0', url: 'https://evil.example.com' },
        { tag: 'v0.3.0', command: 'anything' }, { tag: 'v0.0.1' }, { tag: 'v0.3.0', restoreData: true },
        { tag: 'v0.3.0', restoreData: 'false' },
    ]) assert.equal((await f.request('/api/system/deployments', body)).status, 400);
    assert.equal(fs.existsSync(path.join(f.root, 'inbox/request.json')), false);
});
