'use strict';

// Local UI acceptance fixture. Never included in the server release package.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('../backend/node_modules/express');
const { registerManagement } = require('../backend/src/management/index.cjs');
const { newCredentials, hashPassword } = require('../backend/src/management/auth-store.cjs');
const { atomicJson, readJson, sha256 } = require('../backend/src/management/contract.cjs');
const { createTarGz } = require('./tar.cjs');
const { extractRelease } = require('../deploy/archive.cjs');
const { runWorker, snapshotData, switchVersion } = require('../deploy/worker.cjs');

(async () => {
    const port = Number(process.argv[2] || 3088);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-ui-'));
    const config = { deployDirectory: path.join(root, 'deploy'), dataDirectory: path.join(root, 'data'), releasesDirectory: path.join(root, 'releases'), currentLink: path.join(root, 'current'), uid: process.getuid?.() || 1000, gid: process.getgid?.() || 1000, port };
    for (const directory of [config.dataDirectory, config.releasesDirectory, ...['state', 'work', 'inbox'].map(name => path.join(config.deployDirectory, name))]) fs.mkdirSync(directory, { recursive: true });
    const releases = ['v0.0.9', 'v0.1.0', 'v0.2.0'].map(tag => {
        const manifest = { formatVersion: 1, repository: 'ywainzh/Sub-Store', tag, commit: 'a'.repeat(40), versions: { backend: '2.39.6', frontend: '2.32.2' }, testedNode: '24.15.0', compatibility: { management: 1, auth: 1, data: { read: ['2.0'], write: '2.0' } } };
        const manifestBytes = Buffer.from(JSON.stringify(manifest));
        const archive = createTarGz([
            { name: `sub-store-server-${tag}/release-manifest.json`, bytes: manifestBytes },
            { name: `sub-store-server-${tag}/backend/dist/sub-store.bundle.js`, bytes: Buffer.from('// UI fixture') },
            { name: `sub-store-server-${tag}/frontend/index.html`, bytes: Buffer.from('<html>UI fixture</html>') },
        ]);
        return { tag, manifest, archive, notes: '改进订阅管理体验。\n修复版本切换后的资源缓存。', local: false, archiveUrl: `https://github.com/ywainzh/Sub-Store/releases/download/${tag}/test.tar.gz`, archiveSha256: sha256(archive), manifestSha256: sha256(manifestBytes) };
    });
    for (const release of releases.slice(0, 2)) extractRelease(release.archive, path.join(config.releasesDirectory, release.tag), release.tag);
    switchVersion(config, 'v0.1.0');
    atomicJson(path.join(config.dataDirectory, 'sub-store.json'), { schemaVersion: '2.0', subs: [], collections: [], files: [], tokens: [], settings: {} });
    atomicJson(path.join(config.dataDirectory, 'root.json'), {});
    const snapshot = snapshotData(config.dataDirectory, path.join(config.deployDirectory, 'snapshot'), 'v0.0.9', 'preview');
    atomicJson(path.join(config.deployDirectory, 'state/installation.json'), { current: 'v0.1.0', previous: 'v0.0.9', snapshot: { tag: snapshot.tag, dataSchema: '2.0', createdAt: snapshot.createdAt } });
    const { credentials } = await newCredentials();
    credentials.password = await hashPassword('test-only-preview');
    atomicJson(path.join(root, 'auth.json'), credentials);
    const env = { NODE_ENV: 'development', SUB_STORE_AUTH_ENABLED: 'true', SUB_STORE_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
        SUB_STORE_AUTH_FILE: path.join(root, 'auth.json'), SUB_STORE_AUTH_SESSIONS_FILE: path.join(root, 'sessions.json'),
        SUB_STORE_DATA_BASE_PATH: config.dataDirectory, SUB_STORE_ONLINE_MANAGEMENT: 'true', SUB_STORE_DEPLOY_DIRECTORY: config.deployDirectory, SUB_STORE_RELEASES_DIRECTORY: config.releasesDirectory };
    const catalog = { list: async () => ({ versions: releases, nextPage: null }), get: async tag => { const item = releases.find(item => item.tag === tag); if (!item) throw new Error('INCOMPATIBLE_RELEASE_MANIFEST'); return item; } };
    const frontend = path.resolve(__dirname, '../frontend-local/dist');
    function createApp() {
        const app = express(); app.use(express.json());
        const current = readJson(path.join(config.currentLink, 'release-manifest.json'));
        app.use((req, res, next) => {
            if (/^\/(api|download|share)(\/|$)/.test(req.path)) return next();
            express.static(frontend)(req, res, () => res.sendFile(path.join(frontend, 'index.html')));
        });
        registerManagement(app, { env, manifest: current, catalog });
        app.get('/api/utils/env', (req, res) => res.json({ status: 'success', data: { backend: 'Node', version: '2.39.6', projectVersion: current.tag, feature: { share: true, archive: true }, meta: { node: { env: {} } } } }));
        app.all('/api/settings', (req, res) => {
            const file = path.join(config.dataDirectory, 'sub-store.json');
            const data = readJson(file);
            if (req.method !== 'GET') {
                data.settings = { ...data.settings, ...req.body };
                atomicJson(file, data);
            }
            res.json({ status: 'success', data: data.settings });
        });
        app.get('/api/*', (req, res) => res.json({ status: 'success', data: [] }));
        return app;
    }
    let app = createApp(); let available = true; let working = false;
    const server = http.createServer((req, res) => {
        if (!available && req.url.startsWith('/api/')) { res.writeHead(503); res.end('Restarting'); return; }
        app(req, res);
    });
    server.listen(port, '127.0.0.1', () => console.log(`UI acceptance fixture: http://127.0.0.1:${port}`));
    const timer = setInterval(async () => {
        if (working || !fs.existsSync(path.join(config.deployDirectory, 'inbox/request.json'))) return;
        working = true;
        try {
            await runWorker(config, { catalog, download: async url => { await delay(1500); return releases.find(item => item.archiveUrl === url).archive; },
                service: async action => {
                    if (action === 'stop') { available = false; await delay(1500); }
                    else { await delay(1500); app = createApp(); available = true; }
                },
                health: async () => { await delay(2500); },
            });
        } finally { working = false; }
    }, 150);
    const stop = () => { clearInterval(timer); server.close(() => { fs.rmSync(root, { recursive: true, force: true }); process.exit(0); }); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
