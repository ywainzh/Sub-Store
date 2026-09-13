#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { assertTag, readJson, atomicJson, sha256, validateManifest } = require('../backend/src/management/contract.cjs');
const { validateCredentials } = require('../backend/src/management/auth-store.cjs');
const { createReleaseCatalog, fetchBytes } = require('../backend/src/management/releases.cjs');
const { extractRelease } = require('./archive.cjs');
const { snapshotData, restoreData, switchVersion, healthCheck, safeRemove } = require('./worker.cjs');

const ROOT = '/opt/sub-store';
const CONFIG = '/etc/sub-store';
const DEPLOY = '/var/lib/sub-store-deploy';
const DATA = '/var/lib/sub-store/data';
const HELPER = '/usr/local/lib/sub-store';
const GATE = '/etc/nginx/sub-store-management-gate.conf';
const NGINX = '/etc/nginx/sites-available/sub-store';
const run = (command, args) => execFileSync(command, args, { stdio: 'pipe', timeout: 90000 });

function writeFile(file, content, mode = 0o644) {
    fs.writeFileSync(file, content, { mode });
    fs.chmodSync(file, mode);
}

function setGate(closed) {
    writeFile(GATE, closed ? 'location ~* ^/(api|download)(/|$) { return 503; }\n' : '# Management is protected by the application.\n');
    run('/usr/sbin/nginx', ['-t']);
    run('/usr/bin/systemctl', ['reload', 'nginx']);
}

function attachGate(origin) {
    let content = fs.readFileSync(NGINX, 'utf8');
    if (!content.includes(`server_name ${new URL(origin).hostname};`)) throw new Error('NGINX_SERVER_NAME_MISMATCH');
    if (!content.includes(`include ${GATE};`)) {
        content = content.replaceAll(`server_name ${new URL(origin).hostname};`, `server_name ${new URL(origin).hostname};\n    include ${GATE};`);
        writeFile(GATE, '# Management gate is open.\n');
        const previous = fs.readFileSync(NGINX, 'utf8');
        writeFile(NGINX, content);
        try { run('/usr/sbin/nginx', ['-t']); }
        catch (error) { writeFile(NGINX, previous); throw error; }
    }
    setGate(true);
}

function secureTree(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('UNEXPECTED_PROGRAM_SYMLINK');
        fs.chownSync(file, 0, 0);
        fs.chmodSync(file, entry.isDirectory() ? 0o755 : 0o644);
        if (entry.isDirectory()) secureTree(file);
    }
    fs.chownSync(directory, 0, 0); fs.chmodSync(directory, 0o755);
}

async function verifyShares(config, request = fetch) {
    const data = readJson(path.join(config.dataDirectory, 'sub-store.json'));
    let verified = 0;
    for (const token of data.tokens || []) {
        if (!['sub', 'col', 'file'].includes(token.type) || !token.name || !token.token) throw new Error('INVALID_EXISTING_SHARE');
        // Do not consume links with a finite usage budget during installation.
        if (token.mode === 'count' || token.expirationMode === 'count' || token.remainingUsage !== undefined || (token.exp && token.exp <= Date.now())) continue;
        const query = new URLSearchParams({ token: token.token, target: 'ClashMeta' });
        const url = `http://127.0.0.1:${config.port}/share/${token.type}/${encodeURIComponent(token.name)}?${query}`;
        const response = await request(url, { signal: AbortSignal.timeout(90000) });
        if (!response.ok || !(await response.text()).trim()) throw new Error('EXISTING_SHARE_CHECK_FAILED');
        verified++;
    }
    return verified;
}

async function install(tag, origin) {
    if (process.getuid?.() !== 0) throw new Error('INSTALLATION_REQUIRES_ROOT');
    assertTag(tag);
    const publicUrl = new URL(origin);
    if (publicUrl.protocol !== 'https:' || publicUrl.origin !== origin) throw new Error('INVALID_PUBLIC_ORIGIN');
    if (fs.existsSync(path.join(DEPLOY, 'state/installation.json'))) throw new Error('ALREADY_INSTALLED_USE_VERSION_MANAGEMENT');
    validateCredentials(readJson(path.join(CONFIG, 'auth.json')));
    if (!fs.existsSync(NGINX)) throw new Error('NGINX_CONFIGURATION_REQUIRED');
    const release = await createReleaseCatalog().get(tag);
    const bytes = await fetchBytes(release.archiveUrl, { maxBytes: 50 * 1024 * 1024, timeout: 180000 });
    if (sha256(bytes) !== release.archiveSha256) throw new Error('RELEASE_CHECKSUM_MISMATCH');
    fs.mkdirSync(ROOT, { recursive: true });
    fs.chownSync(ROOT, 0, 0); fs.chmodSync(ROOT, 0o755);
    const candidate = path.join(ROOT, `.install-${crypto.randomUUID()}`);
    extractRelease(bytes, candidate, tag);
    if (sha256(fs.readFileSync(path.join(candidate, 'release-manifest.json'))) !== release.manifestSha256) throw new Error('RELEASE_MANIFEST_MISMATCH');
    validateManifest(readJson(path.join(candidate, 'release-manifest.json')), tag);
    try { run('/usr/bin/id', ['substore']); }
    catch { run('/usr/sbin/useradd', ['--system', '--user-group', '--home-dir', '/var/lib/sub-store', '--shell', '/usr/sbin/nologin', 'substore']); }
    const uid = Number(run('/usr/bin/id', ['-u', 'substore']).toString().trim());
    const gid = Number(run('/usr/bin/id', ['-g', 'substore']).toString().trim());
    if (!uid || !gid || run('/usr/bin/id', ['-nG', 'substore']).toString().trim() !== 'substore') throw new Error('APPLICATION_USER_MUST_BE_UNPRIVILEGED');
    const directory = (target, mode, owner = 0, group = gid) => {
        fs.mkdirSync(target, { recursive: true, mode });
        fs.chownSync(target, owner, group); fs.chmodSync(target, mode);
    };
    directory(CONFIG, 0o750);
    directory('/var/lib/sub-store', 0o755, 0, 0);
    directory(DATA, 0o700, uid);
    directory('/var/lib/sub-store-auth', 0o700, uid);
    directory(DEPLOY, 0o750);
    directory(path.join(DEPLOY, 'state'), 0o750);
    directory(path.join(DEPLOY, 'work'), 0o700);
    directory(path.join(DEPLOY, 'inbox'), 0o700, uid);
    directory(path.join(ROOT, 'releases'), 0o755, 0, 0);
    const config = { deployDirectory: DEPLOY, dataDirectory: DATA, releasesDirectory: path.join(ROOT, 'releases'), currentLink: path.join(ROOT, 'current'), port: 3000, uid, gid };
    const legacy = fs.existsSync(path.join(ROOT, 'backend/dist/sub-store.bundle.js'));
    const previous = legacy ? 'v0.0.1' : null;
    if (legacy) {
        const legacyDirectory = path.join(config.releasesDirectory, previous);
        if (fs.existsSync(legacyDirectory)) throw new Error('LEGACY_RELEASE_ALREADY_EXISTS');
        fs.mkdirSync(path.join(legacyDirectory, 'backend'), { recursive: true });
        fs.cpSync(path.join(ROOT, 'backend/dist'), path.join(legacyDirectory, 'backend/dist'), { recursive: true });
        fs.cpSync(path.join(ROOT, 'frontend'), path.join(legacyDirectory, 'frontend'), { recursive: true });
        secureTree(legacyDirectory);
    }
    fs.renameSync(candidate, path.join(config.releasesDirectory, tag));
    fs.mkdirSync(HELPER, { recursive: true });
    fs.cpSync(path.join(config.releasesDirectory, tag, 'deploy'), path.join(HELPER, 'deploy'), { recursive: true });
    fs.cpSync(path.join(config.releasesDirectory, tag, 'backend/src/management'), path.join(HELPER, 'backend/src/management'), { recursive: true });
    secureTree(HELPER);
    fs.chownSync(path.join(CONFIG, 'auth.json'), 0, gid); fs.chmodSync(path.join(CONFIG, 'auth.json'), 0o640);
    atomicJson(path.join(CONFIG, 'deploy.json'), config);
    const baseEnv = [
        'NODE_ENV=production', 'SUB_STORE_BACKEND_API_PORT=3000', 'SUB_STORE_BACKEND_API_HOST=127.0.0.1',
        'SUB_STORE_BACKEND_MERGE=ON', 'SUB_STORE_FRONTEND_BACKEND_PATH=/',
        `SUB_STORE_CORS_ALLOWED_ORIGINS=${origin}`, `SUB_STORE_PUBLIC_ORIGIN=${origin}`,
        `SUB_STORE_DATA_BASE_PATH=${DATA}`,
    ];
    writeFile(path.join(CONFIG, 'app.env'), [...baseEnv,
        `SUB_STORE_FRONTEND_PATH=${ROOT}/current/frontend`, 'SUB_STORE_AUTH_ENABLED=true',
        `SUB_STORE_AUTH_FILE=${CONFIG}/auth.json`, 'SUB_STORE_AUTH_SESSIONS_FILE=/var/lib/sub-store-auth/sessions.json',
        'SUB_STORE_ONLINE_MANAGEMENT=true', `SUB_STORE_RELEASE_MANIFEST=${ROOT}/current/release-manifest.json`,
    ].join('\n') + '\n', 0o640);
    fs.chownSync(path.join(CONFIG, 'app.env'), 0, gid);
    if (legacy) {
        writeFile(path.join(CONFIG, 'legacy.env'), [...baseEnv, `SUB_STORE_FRONTEND_PATH=${ROOT}/releases/v0.0.1/frontend`].join('\n') + '\n', 0o640);
        fs.chownSync(path.join(CONFIG, 'legacy.env'), 0, gid);
        writeFile(path.join(CONFIG, 'legacy.service'), fs.readFileSync(path.join(HELPER, 'deploy/sub-store.service'), 'utf8')
            .replace(`${CONFIG}/app.env`, `${CONFIG}/legacy.env`).replace(`${ROOT}/current/`, `${ROOT}/releases/v0.0.1/`));
    }
    attachGate(origin);
    const originalService = fs.existsSync('/etc/systemd/system/sub-store.service') ? fs.readFileSync('/etc/systemd/system/sub-store.service') : null;
    if (originalService) run('/usr/bin/systemctl', ['stop', 'sub-store.service']);
    let snapshot;
    try {
        if (legacy) {
            snapshot = snapshotData(path.join(ROOT, 'backend'), path.join(DEPLOY, 'snapshot'), previous, crypto.randomUUID());
            restoreData(path.join(DEPLOY, 'snapshot'), DATA, config);
        } else {
            atomicJson(path.join(DATA, 'sub-store.json'), { schemaVersion: '2.0', subs: [], collections: [], files: [], settings: {}, tokens: [] });
            atomicJson(path.join(DATA, 'root.json'), {});
            for (const name of ['sub-store.json', 'root.json']) fs.chownSync(path.join(DATA, name), uid, gid);
        }
        switchVersion(config, tag);
        for (const name of ['sub-store.service', 'sub-store-deploy.service', 'sub-store-deploy.path']) {
            fs.copyFileSync(path.join(HELPER, 'deploy', name), `/etc/systemd/system/${name}`);
        }
        atomicJson(path.join(DEPLOY, 'state/installation.json'), {
            current: tag, previous, snapshot: snapshot ? { tag: previous, dataSchema: snapshot.dataSchema, createdAt: snapshot.createdAt, id: snapshot.id } : null,
            activeDeployment: null,
        }, 0o640);
        fs.chownSync(path.join(DEPLOY, 'state/installation.json'), 0, gid);
        run('/usr/bin/systemctl', ['daemon-reload']);
        run('/usr/bin/systemctl', ['enable', 'sub-store.service', 'sub-store-deploy.service', 'sub-store-deploy.path']);
        run('/usr/bin/systemctl', ['start', 'sub-store.service']);
        await healthCheck(config, tag);
        for (const endpoint of ['/api/subs', '/api/storage', '/download/unauthenticated-check']) {
            const response = await fetch(`http://127.0.0.1:${config.port}${endpoint}`);
            if (response.status !== 401) throw new Error('ANONYMOUS_MANAGEMENT_NOT_BLOCKED');
        }
        const verifiedShares = await verifyShares(config);
        run('/usr/bin/systemctl', ['start', 'sub-store-deploy.path']);
        setGate(false);
        for (const name of ['backend', 'frontend']) if (fs.existsSync(path.join(ROOT, name))) safeRemove(ROOT, path.join(ROOT, name));
        fs.rmSync(path.join(ROOT, '.env'), { force: true });
        console.log(JSON.stringify({ installed: tag, previous, verifiedShares, authEnabled: true }));
    } catch (error) {
        setGate(true);
        run('/usr/bin/systemctl', ['stop', 'sub-store.service']);
        if (legacy && snapshot) {
            restoreData(path.join(DEPLOY, 'snapshot'), DATA, config);
            fs.copyFileSync(path.join(CONFIG, 'legacy.service'), '/etc/systemd/system/sub-store.service');
            run('/usr/bin/systemctl', ['daemon-reload']);
            run('/usr/bin/systemctl', ['start', 'sub-store.service']);
        } else if (legacy && originalService) {
            fs.writeFileSync('/etc/systemd/system/sub-store.service', originalService);
            run('/usr/bin/systemctl', ['daemon-reload']);
            run('/usr/bin/systemctl', ['start', 'sub-store.service']);
        }
        throw error;
    }
}

if (require.main === module) {
    const [tag, origin] = process.argv.slice(2);
    install(tag, origin).catch(error => {
        console.error(/^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'INSTALLATION_FAILED_MANAGEMENT_GATE_REMAINS_CLOSED');
        process.exitCode = 1;
    });
}
module.exports = { install, setGate, verifyShares };
