#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readJson, atomicJson } = require('../backend/src/management/contract.cjs');
const { setGate } = require('./install.cjs');
const { restoreData, validateSnapshot, switchVersion } = require('./worker.cjs');

if (process.getuid?.() !== 0) throw new Error('EMERGENCY_RECOVERY_REQUIRES_ROOT');
const args = process.argv.slice(2);
// Serialize SSH emergency recovery with the exact lock used by systemd.
// The marker is private to this root-only re-execution and carries no user data.
if (args[0] !== '--lock-held') {
    try {
        execFileSync('/usr/bin/flock', ['-n', '/run/lock/sub-store-deploy.lock', process.execPath, __filename, '--lock-held', ...args], { stdio: 'inherit' });
    } catch (error) { process.exit(error.status || 1); }
    process.exit(0);
}
args.shift();
if (args.some(arg => arg !== '--restore-snapshot')) throw new Error('INVALID_ARGUMENTS');
const config = readJson('/etc/sub-store/deploy.json');
if (!fs.existsSync(path.join(config.releasesDirectory, 'v0.0.1/backend/dist/sub-store.bundle.js'))) throw new Error('LEGACY_EMERGENCY_RELEASE_NOT_RETAINED');
if (fs.existsSync(path.join(config.deployDirectory, 'state/transaction.json'))) throw new Error('RECOVER_ACTIVE_TRANSACTION_FIRST');
const snapshot = path.join(config.deployDirectory, 'snapshot');
if (args.includes('--restore-snapshot') && validateSnapshot(snapshot).tag !== 'v0.0.1') throw new Error('LEGACY_SNAPSHOT_NOT_AVAILABLE');
const systemctl = (...parameters) => execFileSync('/usr/bin/systemctl', parameters, { stdio: 'pipe', timeout: 90000 });
setGate(true);
systemctl('stop', 'sub-store-deploy.path', 'sub-store-deploy.service', 'sub-store.service');
if (args.includes('--restore-snapshot')) restoreData(snapshot, config.dataDirectory, config);
switchVersion(config, 'v0.0.1');
fs.copyFileSync('/etc/sub-store/legacy.service', '/etc/systemd/system/sub-store.service');
systemctl('daemon-reload');
systemctl('start', 'sub-store.service');
const stateFile = path.join(config.deployDirectory, 'state/installation.json');
const state = readJson(stateFile);
atomicJson(stateFile, { ...state, previous: state.current, current: 'v0.0.1', activeDeployment: null, emergency: true }, 0o640);
fs.chownSync(stateFile, 0, config.gid);
console.log('Legacy service restored. Public management remains CLOSED; share tokens are unchanged.');
