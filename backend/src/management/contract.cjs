'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPOSITORY = 'ywainzh/Sub-Store';
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANAGEMENT_VERSION = 1;
const AUTH_VERSION = 1;
const DATA_SCHEMA = '2.0';
const TERMINAL_PHASES = new Set(['succeeded', 'failed']);

function assertTag(tag) {
    if (typeof tag !== 'string' || tag.length > 64 || !TAG_PATTERN.test(tag)) {
        throw new Error('INVALID_VERSION_TAG');
    }
    return tag;
}

function compareTags(a, b) {
    const left = assertTag(a).slice(1).split('.').map(BigInt);
    const right = assertTag(b).slice(1).split('.').map(BigInt);
    for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
    }
    return 0;
}

function validateManifest(manifest, tag) {
    assertTag(tag);
    if (
        !manifest || manifest.formatVersion !== 1 || manifest.repository !== REPOSITORY ||
        manifest.tag !== tag || !/^[a-f0-9]{40}$/.test(manifest.commit || '') ||
        manifest.compatibility?.management !== MANAGEMENT_VERSION ||
        manifest.compatibility?.auth !== AUTH_VERSION ||
        !Array.isArray(manifest.compatibility?.data?.read) ||
        !manifest.compatibility.data.read.length ||
        !manifest.compatibility.data.read.every(value => typeof value === 'string' && /^\d+\.\d+$/.test(value)) ||
        !manifest.compatibility.data.read.includes(manifest.compatibility.data.write) ||
        typeof manifest.versions?.backend !== 'string' || typeof manifest.versions?.frontend !== 'string' ||
        !/^\d+\.\d+\.\d+$/.test(manifest.testedNode || '')
    ) throw new Error('INCOMPATIBLE_RELEASE_MANIFEST');
    return manifest;
}

function canReadData(manifest, schema) {
    return manifest.compatibility.data.read.includes(schema);
}

function readJson(file, { optional = false, maxBytes = 1024 * 1024 } = {}) {
    let descriptor;
    try {
        descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.size > maxBytes) throw new Error('INVALID_STATE_FILE');
        return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } catch (error) {
        if (optional && error.code === 'ENOENT') return null;
        throw error;
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

function atomicJson(file, data, mode = 0o600) {
    const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', mode);
    try {
        fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`);
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    try {
        fs.renameSync(temporary, file);
        // Persist the directory entry as well as the contents on Linux.
        if (process.platform !== 'win32') {
            const directory = fs.openSync(path.dirname(file), 'r');
            try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        }
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

function isWithin(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
    REPOSITORY, TAG_PATTERN, MANAGEMENT_VERSION, AUTH_VERSION, DATA_SCHEMA,
    TERMINAL_PHASES, assertTag, compareTags, validateManifest, canReadData,
    readJson, atomicJson, isWithin, sha256,
};
