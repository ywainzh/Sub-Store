'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTarGz } = require('../../scripts/tar.cjs');
const { extractRelease } = require('../../deploy/archive.cjs');
const { runWorker, snapshotData, switchVersion } = require('../../deploy/worker.cjs');
const { atomicJson, readJson, sha256 } = require('../../backend/src/management/contract.cjs');

const manifest = (tag, schema = '2.0') => ({
    formatVersion: 1, repository: 'ywainzh/Sub-Store', tag, commit: 'a'.repeat(40),
    versions: { backend: '2.39.6', frontend: '2.32.2' }, testedNode: '24.15.0',
    compatibility: { management: 1, auth: 1, data: { read: [schema], write: schema } },
});

function makeRelease(tag, schema = '2.0', extraEntries = []) {
    const value = manifest(tag, schema);
    const manifestBytes = Buffer.from(JSON.stringify(value));
    const archive = createTarGz([
        { name: `sub-store-server-${tag}/release-manifest.json`, bytes: manifestBytes },
        { name: `sub-store-server-${tag}/backend/dist/sub-store.bundle.js`, bytes: Buffer.from('// test application') },
        { name: `sub-store-server-${tag}/frontend/index.html`, bytes: Buffer.from('<html>Test</html>') },
        ...extraEntries,
    ]);
    return { tag, manifest: value, archive, archiveUrl: 'https://github.com/ywainzh/Sub-Store/releases/download/' + tag + '/test.tar.gz', archiveSha256: sha256(archive), manifestSha256: sha256(manifestBytes) };
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-deploy-test-'));
    const config = {
        deployDirectory: path.join(root, 'deploy'), releasesDirectory: path.join(root, 'releases'),
        dataDirectory: path.join(root, 'data'), currentLink: path.join(root, 'current'),
        uid: process.getuid?.() || 1000, gid: process.getgid?.() || 1000, port: 3000,
    };
    for (const directory of [config.releasesDirectory, config.dataDirectory, ...['state', 'work', 'inbox'].map(name => path.join(config.deployDirectory, name))]) fs.mkdirSync(directory, { recursive: true });
    for (const tag of ['v0.1.0', 'v0.0.9']) extractRelease(makeRelease(tag).archive, path.join(config.releasesDirectory, tag), tag);
    switchVersion(config, 'v0.1.0');
    atomicJson(path.join(config.dataDirectory, 'sub-store.json'), { schemaVersion: '2.0', marker: 'original', tokens: ['unchanged-share'] });
    atomicJson(path.join(config.dataDirectory, 'root.json'), { cache: 'original-cache' });
    const installationFile = path.join(config.deployDirectory, 'state/installation.json');
    atomicJson(installationFile, { current: 'v0.1.0', previous: 'v0.0.9', activeDeployment: null });
    fs.writeFileSync(path.join(root, 'auth.json'), 'independent authentication state');
    const requests = [];
    const release = makeRelease('v0.2.0');
    const dependencies = {
        catalog: { get: async tag => { requests.push(tag); return release; } },
        download: async () => release.archive,
        service: async () => {}, health: async () => {},
    };
    const submit = (tag = 'v0.2.0', restoreData = false) => {
        const request = { id: crypto.randomUUID(), tag, restoreData };
        atomicJson(path.join(config.deployDirectory, 'inbox/request.json'), request);
        return request;
    };
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, config, installationFile, release, dependencies, requests, submit,
        data: () => readJson(path.join(config.dataDirectory, 'sub-store.json')),
        state: () => readJson(installationFile),
    };
}

test('successful upgrade retains exactly two programs, one consistent data snapshot and independent auth', async t => {
    const f = fixture(t); f.submit();
    const result = await runWorker(f.config, f.dependencies);
    assert.equal(result.phase, 'succeeded');
    assert.equal(f.state().current, 'v0.2.0');
    assert.equal(f.state().previous, 'v0.1.0');
    assert.deepEqual(fs.readdirSync(f.config.releasesDirectory).sort(), ['v0.1.0', 'v0.2.0']);
    assert.equal(f.state().snapshot.tag, 'v0.1.0');
    assert.equal(readJson(path.join(f.config.deployDirectory, 'snapshot/sub-store.json')).marker, 'original');
    assert.deepEqual(fs.readdirSync(path.join(f.config.deployDirectory, 'work')), []);
    assert.equal(fs.readFileSync(path.join(f.root, 'auth.json'), 'utf8'), 'independent authentication state');
});

test('local previous release can roll back with GitHub offline and preserve newest subscriptions', async t => {
    const f = fixture(t); f.submit(); await runWorker(f.config, f.dependencies);
    atomicJson(path.join(f.config.dataDirectory, 'sub-store.json'), { ...f.data(), marker: 'newest' });
    f.submit('v0.1.0');
    const offline = async () => { throw new Error('GITHUB_OFFLINE'); };
    const result = await runWorker(f.config, { ...f.dependencies, catalog: { get: offline }, download: offline });
    assert.equal(result.phase, 'succeeded'); assert.equal(f.state().current, 'v0.1.0');
    assert.equal(f.data().marker, 'newest'); assert.equal(f.state().snapshot.tag, 'v0.2.0');
});

test('explicit restore uses the matching snapshot, then retains the pre-operation latest data', async t => {
    const f = fixture(t); f.submit(); await runWorker(f.config, f.dependencies);
    atomicJson(path.join(f.config.dataDirectory, 'sub-store.json'), { ...f.data(), marker: 'after-upgrade' });
    f.submit('v0.1.0', true);
    const result = await runWorker(f.config, f.dependencies);
    assert.equal(result.phase, 'succeeded'); assert.equal(f.data().marker, 'original');
    assert.equal(readJson(path.join(f.config.deployDirectory, 'snapshot/sub-store.json')).marker, 'after-upgrade');
    assert.equal(f.state().snapshot.tag, 'v0.2.0');
});

test('health failure restores both the running program and the exact pre-operation data', async t => {
    const f = fixture(t); f.submit();
    const result = await runWorker(f.config, { ...f.dependencies,
        service: async action => {
            if (action === 'start' && fs.realpathSync(f.config.currentLink).endsWith('v0.2.0')) atomicJson(path.join(f.config.dataDirectory, 'sub-store.json'), { schemaVersion: '9.0', marker: 'broken migration' });
        },
        health: async tag => { if (tag === 'v0.2.0') throw new Error('HEALTH_CHECK_FAILED'); },
    });
    assert.equal(result.phase, 'failed'); assert.equal(result.restored, true);
    assert.equal(f.state().current, 'v0.1.0'); assert.equal(f.data().marker, 'original');
    assert.equal(f.data().schemaVersion, '2.0');
    assert.deepEqual(fs.readdirSync(f.config.releasesDirectory).sort(), ['v0.0.9', 'v0.1.0']);
});

test('download and checksum failures do not stop the running application or claim success', async t => {
    for (const reason of ['DOWNLOAD_FAILED', 'RELEASE_CHECKSUM_MISMATCH']) {
        const f = fixture(t); f.submit(); let stops = 0;
        const result = await runWorker(f.config, { ...f.dependencies,
            download: async () => { if (reason === 'DOWNLOAD_FAILED') throw new Error(reason); return Buffer.from('corrupt'); },
            service: async () => { stops++; },
        });
        assert.equal(result.phase, 'failed'); assert.equal(result.errorCode, reason);
        assert.equal(stops, 0); assert.equal(f.state().current, 'v0.1.0');
        assert.equal(f.data().marker, 'original');
    }
});

test('incompatible data, mismatched snapshots and legacy releases cannot be selected', async t => {
    const f = fixture(t); f.submit(); let stops = 0;
    const incompatible = makeRelease('v0.2.0', '1.0');
    const result = await runWorker(f.config, { ...f.dependencies,
        catalog: { get: async () => incompatible }, download: async () => incompatible.archive,
        service: async () => { stops++; },
    });
    assert.equal(result.phase, 'failed'); assert.equal(result.errorCode, 'INCOMPATIBLE_DATA_SCHEMA'); assert.equal(stops, 0);
    f.submit('v0.0.9', true);
    assert.equal((await runWorker(f.config, f.dependencies)).phase, 'failed');
    f.submit('v0.0.1');
    assert.equal((await runWorker(f.config, { ...f.dependencies, catalog: { get: async () => { throw new Error('INCOMPLETE_RELEASE'); } } })).phase, 'failed');
});

test('an interrupted switch is recovered using the persistent transaction after a worker restart', async t => {
    const f = fixture(t);
    const id = crypto.randomUUID(); const work = path.join(f.config.deployDirectory, 'work', id);
    fs.mkdirSync(work);
    snapshotData(f.config.dataDirectory, path.join(work, 'before'), 'v0.1.0', id);
    extractRelease(f.release.archive, path.join(f.config.releasesDirectory, 'v0.2.0'), 'v0.2.0');
    const oldInstallation = f.state();
    atomicJson(path.join(f.config.deployDirectory, 'state', `${id}.json`), { id, tag: 'v0.2.0', phase: 'starting', restoreData: false });
    atomicJson(path.join(f.config.deployDirectory, 'state/transaction.json'), { id, oldTag: 'v0.1.0', oldInstallation, stopped: true, snapshotReady: true, verified: false });
    switchVersion(f.config, 'v0.2.0');
    atomicJson(path.join(f.config.dataDirectory, 'sub-store.json'), { schemaVersion: '9.0', marker: 'interrupted' });
    const result = await runWorker(f.config, f.dependencies);
    assert.equal(result.phase, 'failed'); assert.equal(result.errorCode, 'INTERRUPTED_DEPLOYMENT');
    assert.equal(f.data().marker, 'original'); assert.equal(f.state().current, 'v0.1.0');
});

test('archive extraction rejects traversal, links, duplicate entries, devices and foreign roots', t => {
    const f = fixture(t);
    for (const [name, type] of [
        ['sub-store-server-v0.2.0/../../escape', '0'], ['sub-store-server-v0.2.0/link', '2'],
        ['sub-store-server-v0.2.0/device', '3'], ['foreign/root', '0'],
        ['sub-store-server-v0.2.0/frontend/index.html', '0'],
    ]) {
        const release = makeRelease('v0.2.0', '2.0', [{ name, type, bytes: Buffer.from('x') }]);
        assert.throws(() => extractRelease(release.archive, path.join(f.root, crypto.randomUUID()), 'v0.2.0'));
    }
    assert.equal(fs.existsSync(path.join(f.root, 'escape')), false);
});

test('interruption after rollback cleanup does not require a deleted temporary snapshot', async t => {
    const f = fixture(t);
    const id = crypto.randomUUID();
    atomicJson(path.join(f.config.deployDirectory, 'state', `${id}.json`), { id, tag: 'v0.2.0', phase: 'rolling-back', restoreData: false });
    atomicJson(path.join(f.config.deployDirectory, 'state/transaction.json'), {
        id, oldTag: 'v0.1.0', oldInstallation: f.state(), stopped: true, snapshotReady: true, verified: false, recovered: true,
    });
    let serviceCalls = 0;
    const result = await runWorker(f.config, { ...f.dependencies, service: async () => { serviceCalls++; } });
    assert.equal(result.phase, 'failed'); assert.equal(result.restored, true);
    assert.equal(serviceCalls, 0); assert.equal(f.state().activeDeployment, null);
    assert.equal(f.data().marker, 'original');
    assert.equal(fs.existsSync(path.join(f.config.deployDirectory, 'state/transaction.json')), false);
});

test('verified deployment resumes after cleanup with only the retained snapshot left', async t => {
    const f = fixture(t);
    const id = crypto.randomUUID();
    const oldInstallation = f.state();
    snapshotData(f.config.dataDirectory, path.join(f.config.deployDirectory, 'snapshot'), 'v0.1.0', id);
    extractRelease(f.release.archive, path.join(f.config.releasesDirectory, 'v0.2.0'), 'v0.2.0');
    switchVersion(f.config, 'v0.2.0');
    atomicJson(path.join(f.config.deployDirectory, 'state', `${id}.json`), { id, tag: 'v0.2.0', phase: 'cleaning', restoreData: false });
    atomicJson(path.join(f.config.deployDirectory, 'state/transaction.json'), { id, oldTag: 'v0.1.0', oldInstallation, stopped: true, snapshotReady: true, verified: true });
    const result = await runWorker(f.config, f.dependencies);
    assert.equal(result.phase, 'succeeded'); assert.equal(f.state().current, 'v0.2.0');
    assert.equal(f.state().activeDeployment, null);
    assert.deepEqual(fs.readdirSync(f.config.releasesDirectory).sort(), ['v0.1.0', 'v0.2.0']);
});

module.exports = { makeRelease, manifest };
