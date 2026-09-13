#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const {
    readJson, atomicJson, assertTag, validateManifest, canReadData, sha256, isWithin, TERMINAL_PHASES,
} = require('../backend/src/management/contract.cjs');
const { createReleaseCatalog, fetchBytes } = require('../backend/src/management/releases.cjs');
const { extractRelease } = require('./archive.cjs');

const DATA_FILES = ['sub-store.json', 'root.json'];
const ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function assertDirectory(directory) {
    if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory) !== path.resolve(directory)) throw new Error('UNSAFE_DEPLOYMENT_DIRECTORY');
}

function readDataFile(file) {
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('INVALID_DATA_FILE');
        const bytes = fs.readFileSync(descriptor);
        const value = JSON.parse(bytes);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_DATA_FILE');
        return bytes;
    } finally { fs.closeSync(descriptor); }
}

function snapshotData(source, destination, tag, id) {
    assertDirectory(source);
    fs.mkdirSync(destination, { mode: 0o700 });
    const files = {};
    for (const name of DATA_FILES) {
        const bytes = readDataFile(path.join(source, name));
        const descriptor = fs.openSync(path.join(destination, name), 'wx', 0o600);
        try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
        finally { fs.closeSync(descriptor); }
        files[name] = sha256(bytes);
    }
    const dataSchema = readJson(path.join(destination, 'sub-store.json')).schemaVersion;
    if (typeof dataSchema !== 'string') throw new Error('UNKNOWN_DATA_SCHEMA');
    const metadata = { tag, dataSchema, id, createdAt: new Date().toISOString(), files };
    atomicJson(path.join(destination, 'snapshot.json'), metadata);
    return metadata;
}

function validateSnapshot(directory) {
    assertDirectory(directory);
    const metadata = readJson(path.join(directory, 'snapshot.json'));
    for (const name of DATA_FILES) {
        if (sha256(readDataFile(path.join(directory, name))) !== metadata.files?.[name]) throw new Error('SNAPSHOT_CHECKSUM_MISMATCH');
    }
    if (readJson(path.join(directory, 'sub-store.json')).schemaVersion !== metadata.dataSchema) throw new Error('INVALID_SNAPSHOT_SCHEMA');
    return metadata;
}

function restoreData(source, destination, config) {
    validateSnapshot(source);
    assertDirectory(destination);
    for (const name of DATA_FILES) {
        const temporary = path.join(destination, `.${name}.restore-${process.pid}`);
        const descriptor = fs.openSync(temporary, 'wx', 0o600);
        try {
            fs.writeFileSync(descriptor, readDataFile(path.join(source, name)));
            if (process.platform !== 'win32') fs.fchownSync(descriptor, config.uid, config.gid);
            fs.fsyncSync(descriptor);
        } finally { fs.closeSync(descriptor); }
        fs.renameSync(temporary, path.join(destination, name));
    }
}

function switchVersion(config, tag) {
    assertTag(tag);
    const target = path.join(config.releasesDirectory, tag);
    assertDirectory(target);
    const temporary = `${config.currentLink}.next`;
    if (fs.lstatSync(path.dirname(temporary)).isSymbolicLink()) throw new Error('UNSAFE_CURRENT_LINK');
    if (fs.existsSync(temporary)) {
        if (!fs.lstatSync(temporary).isSymbolicLink() || !isWithin(config.releasesDirectory, fs.readlinkSync(temporary))) throw new Error('UNSAFE_CURRENT_LINK');
        fs.unlinkSync(temporary);
    }
    fs.symlinkSync(target, temporary, process.platform === 'win32' ? 'junction' : 'dir');
    // Windows test fixtures use junctions; production Linux always replaces atomically.
    if (process.platform === 'win32' && fs.existsSync(config.currentLink)) {
        if (!fs.lstatSync(config.currentLink).isSymbolicLink()) throw new Error('UNSAFE_CURRENT_LINK');
        fs.unlinkSync(config.currentLink);
    }
    fs.renameSync(temporary, config.currentLink);
}

async function healthCheck(config, tag) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
            const body = await response.json();
            if (response.ok && body.status === 'success' && body.data?.ready === true && body.data?.authEnabled === true && body.data?.projectVersion === tag) return;
        } catch { /* The application may still be restarting. */ }
        await delay(1000);
    }
    throw new Error('HEALTH_CHECK_FAILED');
}

function safeRemove(parent, target) {
    if (!isWithin(parent, target) || path.resolve(parent) === path.resolve(target)) throw new Error('UNSAFE_CLEANUP_PATH');
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('UNSAFE_CLEANUP_LINK');
    fs.rmSync(target, { recursive: true, force: true });
}

async function runWorker(config, dependencies = {}) {
    const catalog = dependencies.catalog || createReleaseCatalog();
    const download = dependencies.download || fetchBytes;
    const service = dependencies.service || (action => execFileSync('/usr/bin/systemctl', [action, 'sub-store.service'], { stdio: 'pipe', timeout: 90000 }));
    const checkHealth = dependencies.health || (tag => healthCheck(config, tag));
    const root = config.deployDirectory;
    const stateDirectory = path.join(root, 'state');
    const workDirectory = path.join(root, 'work');
    const inbox = path.join(root, 'inbox', 'request.json');
    const installationFile = path.join(stateDirectory, 'installation.json');
    const journalFile = path.join(stateDirectory, 'transaction.json');
    const snapshotDirectory = path.join(root, 'snapshot');
    for (const directory of [root, stateDirectory, workDirectory, config.releasesDirectory, config.dataDirectory]) assertDirectory(directory);
    let journal = readJson(journalFile, { optional: true });
    let job;
    let installation;
    let work;

    function writeJob(phase, extra = {}) {
        job = { ...job, ...extra, phase, updatedAt: new Date().toISOString() };
        atomicJson(path.join(stateDirectory, `${job.id}.json`), job, 0o640);
    }
    const writeJournal = () => atomicJson(journalFile, journal);
    const beforeDirectory = () => {
        const staged = path.join(work, 'before');
        return fs.existsSync(staged) ? staged : snapshotDirectory;
    };
    function cleanupVersions(current, previous) {
        for (const entry of fs.readdirSync(config.releasesDirectory, { withFileTypes: true })) {
            if (entry.name === current || entry.name === previous) continue;
            assertTag(entry.name);
            safeRemove(config.releasesDirectory, path.join(config.releasesDirectory, entry.name));
        }
    }
    function cleanJobHistory() {
        const files = fs.readdirSync(stateDirectory).filter(name => ID_PATTERN.test(name.replace(/\.json$/, '')))
            .map(name => ({ name, time: fs.statSync(path.join(stateDirectory, name)).mtimeMs })).sort((a, b) => b.time - a.time);
        for (const file of files.slice(20)) fs.unlinkSync(path.join(stateDirectory, file.name));
    }
    function commit() {
        const staged = path.join(work, 'before');
        const retired = path.join(work, 'retired-snapshot');
        if (fs.existsSync(staged)) {
            if (fs.existsSync(snapshotDirectory)) fs.renameSync(snapshotDirectory, retired);
            fs.renameSync(staged, snapshotDirectory);
        }
        const snapshot = validateSnapshot(snapshotDirectory);
        if (snapshot.id !== job.id) throw new Error('SNAPSHOT_TRANSACTION_MISMATCH');
        installation = {
            ...installation, current: job.tag, previous: journal.oldTag,
            snapshot: { tag: snapshot.tag, dataSchema: snapshot.dataSchema, createdAt: snapshot.createdAt, id: snapshot.id },
            activeDeployment: job.id, lastDeployment: job.id,
        };
        atomicJson(installationFile, installation, 0o640);
        cleanupVersions(job.tag, journal.oldTag);
        safeRemove(workDirectory, work);
        cleanJobHistory();
        writeJob('succeeded', { current: job.tag, completedAt: new Date().toISOString(), restoredData: job.restoreData });
        atomicJson(installationFile, { ...installation, activeDeployment: null }, 0o640);
        fs.rmSync(journalFile, { force: true });
    }

    async function rollback(errorCode) {
        let restored = Boolean(journal.recovered);
        if (journal.stopped && !journal.recovered) {
            writeJob('rolling-back', { errorCode });
            try {
                await service('stop');
                if (journal.snapshotReady) {
                    const source = beforeDirectory();
                    if (validateSnapshot(source).id !== job.id) throw new Error('SNAPSHOT_TRANSACTION_MISMATCH');
                    restoreData(source, config.dataDirectory, config);
                }
                switchVersion(config, journal.oldTag);
                await service('start');
                await checkHealth(journal.oldTag);
                restored = true;
                journal.recovered = true;
                writeJournal();
            } catch {
                writeJob('recovery-required', { errorCode, recoveryRequired: true });
                throw new Error('AUTOMATIC_RECOVERY_FAILED');
            }
        }
        installation = { ...journal.oldInstallation, activeDeployment: job.id, lastDeployment: job.id };
        const retired = path.join(work, 'retired-snapshot');
        if (fs.existsSync(retired)) {
            safeRemove(root, snapshotDirectory);
            fs.renameSync(retired, snapshotDirectory);
        } else if (fs.existsSync(snapshotDirectory) && validateSnapshot(snapshotDirectory).id === job.id) {
            const snapshot = validateSnapshot(snapshotDirectory);
            installation.snapshot = { tag: snapshot.tag, dataSchema: snapshot.dataSchema, createdAt: snapshot.createdAt, id: snapshot.id };
        }
        atomicJson(installationFile, installation, 0o640);
        cleanupVersions(installation.current, installation.previous);
        safeRemove(workDirectory, work);
        writeJob('failed', { errorCode, restored, current: installation.current, completedAt: new Date().toISOString() });
        atomicJson(installationFile, { ...installation, activeDeployment: null }, 0o640);
        fs.rmSync(journalFile, { force: true });
    }

    if (journal) {
        if (!ID_PATTERN.test(journal.id)) throw new Error('INVALID_DEPLOYMENT_JOURNAL');
        job = readJson(path.join(stateDirectory, `${journal.id}.json`));
        installation = journal.oldInstallation;
        work = path.join(workDirectory, job.id);
        if (journal.verified) {
            let healthy = false;
            try { await checkHealth(job.tag); healthy = true; } catch { /* Restore before resuming. */ }
            if (healthy) commit();
            else await rollback('INTERRUPTED_DEPLOYMENT');
        } else await rollback('INTERRUPTED_DEPLOYMENT');
    }
    if (!fs.existsSync(inbox)) return job || null;
    try {
        const request = readJson(inbox, { maxBytes: 4096 });
        if (!request || !ID_PATTERN.test(request.id) || typeof request.restoreData !== 'boolean' ||
            Object.keys(request).some(key => !['id', 'tag', 'restoreData'].includes(key))) throw new Error('INVALID_DEPLOYMENT_REQUEST');
        assertTag(request.tag);
        if (fs.existsSync(path.join(stateDirectory, `${request.id}.json`))) throw new Error('DUPLICATE_DEPLOYMENT_ID');
        job = { ...request, phase: 'queued', createdAt: new Date().toISOString() };
    } catch (error) {
        fs.unlinkSync(inbox);
        throw error;
    }
    installation = readJson(installationFile);
    const oldTag = assertTag(installation.current);
    // Never treat an arbitrary existing directory as the running release.
    if (fs.realpathSync(config.currentLink) !== path.join(config.releasesDirectory, oldTag)) throw new Error('CURRENT_VERSION_MISMATCH');
    work = path.join(workDirectory, job.id);
    fs.mkdirSync(work, { mode: 0o700 });
    journal = { id: job.id, oldTag, oldInstallation: installation, stopped: false, snapshotReady: false, verified: false };
    writeJob('resolving');
    writeJournal();
    atomicJson(installationFile, { ...installation, activeDeployment: job.id }, 0o640);
    fs.unlinkSync(inbox);
    try {
        if (job.tag === oldTag) throw new Error('ALREADY_CURRENT_VERSION');
        const targetDirectory = path.join(config.releasesDirectory, job.tag);
        let targetManifest;
        if (job.tag === installation.previous && fs.existsSync(targetDirectory)) {
            targetManifest = validateManifest(readJson(path.join(targetDirectory, 'release-manifest.json')), job.tag);
        } else {
            const release = await catalog.get(job.tag);
            targetManifest = validateManifest(release.manifest, job.tag);
            writeJob('downloading');
            const bytes = await download(release.archiveUrl, { maxBytes: 50 * 1024 * 1024, timeout: 180000 });
            writeJob('verifying');
            if (sha256(bytes) !== release.archiveSha256) throw new Error('RELEASE_CHECKSUM_MISMATCH');
            const candidate = path.join(work, 'candidate');
            extractRelease(bytes, candidate, job.tag);
            const manifestBytes = fs.readFileSync(path.join(candidate, 'release-manifest.json'));
            if (sha256(manifestBytes) !== release.manifestSha256) throw new Error('RELEASE_MANIFEST_MISMATCH');
            validateManifest(JSON.parse(manifestBytes), job.tag);
            writeJob('preparing');
            if (fs.existsSync(targetDirectory)) throw new Error('CANDIDATE_ALREADY_EXISTS');
            // systemd mounts the writable work and program directories separately.
            // Copy before stopping the app; rollback removes any incomplete target.
            fs.cpSync(candidate, targetDirectory, { recursive: true, force: false, errorOnExist: true });
        }
        const desiredSchema = job.restoreData ? validateSnapshot(snapshotDirectory).dataSchema : readJson(path.join(config.dataDirectory, 'sub-store.json')).schemaVersion;
        if ((job.restoreData && validateSnapshot(snapshotDirectory).tag !== job.tag) || !canReadData(targetManifest, desiredSchema)) throw new Error('INCOMPATIBLE_DATA_SCHEMA');
        writeJob('stopping');
        journal.stopped = true;
        writeJournal();
        await service('stop');
        writeJob('snapshotting');
        const snapshot = snapshotData(config.dataDirectory, path.join(work, 'before'), oldTag, job.id);
        journal.snapshotReady = true;
        writeJournal();
        if (!job.restoreData && !canReadData(targetManifest, snapshot.dataSchema)) throw new Error('INCOMPATIBLE_DATA_SCHEMA');
        writeJob('switching');
        if (job.restoreData) restoreData(snapshotDirectory, config.dataDirectory, config);
        switchVersion(config, job.tag);
        writeJob('starting');
        await service('start');
        writeJob('checking');
        await checkHealth(job.tag);
        journal.verified = true;
        writeJournal();
        writeJob('cleaning');
        commit();
    } catch (error) {
        if (journal.verified) {
            writeJob('cleaning', { errorCode: 'CLEANUP_PENDING' });
            throw new Error('CLEANUP_PENDING');
        }
        const code = /^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'DEPLOYMENT_FAILED';
        await rollback(code);
    }
    return job;
}

if (require.main === module) {
    if (process.getuid?.() !== 0) throw new Error('DEPLOYMENT_WORKER_REQUIRES_ROOT');
    const config = readJson('/etc/sub-store/deploy.json');
    runWorker(config).then(job => {
        if (job) console.log(`Deployment ${job.id}: ${job.phase}`);
    }).catch(error => {
        console.error(/^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'DEPLOYMENT_WORKER_FAILED');
        process.exitCode = 1;
    });
}

module.exports = { runWorker, snapshotData, validateSnapshot, restoreData, switchVersion, healthCheck, safeRemove };
