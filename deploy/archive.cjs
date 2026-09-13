'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { assertTag, isWithin } = require('../backend/src/management/contract.cjs');

// Release archives are USTAR, with regular files and directories only. Never invoke
// a shell or let tar materialize links, devices, ownership, PAX paths or permissions.
function extractRelease(archive, destination, tag) {
    assertTag(tag);
    if (fs.existsSync(destination)) throw new Error('CANDIDATE_ALREADY_EXISTS');
    const tar = zlib.gunzipSync(archive, { maxOutputLength: 160 * 1024 * 1024 });
    const prefix = `sub-store-server-${tag}`;
    const entries = [];
    const names = new Set();
    let offset = 0;
    const string = buffer => buffer.toString('utf8').split('\0')[0];
    const octal = buffer => {
        const value = string(buffer).trim();
        if (!/^[0-7]+$/.test(value)) throw new Error('INVALID_ARCHIVE_NUMBER');
        return parseInt(value, 8);
    };
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(byte => byte === 0)) {
            if (!tar.subarray(offset).every(byte => byte === 0)) throw new Error('INVALID_ARCHIVE_TRAILER');
            break;
        }
        const expected = octal(header.subarray(148, 156));
        const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
        if (actual !== expected || string(header.subarray(257, 263)) !== 'ustar') throw new Error('INVALID_ARCHIVE_HEADER');
        const name = [string(header.subarray(345, 500)), string(header.subarray(0, 100))].filter(Boolean).join('/').replace(/\/$/, '');
        const type = String.fromCharCode(header[156]);
        if (!['0', '\0', '5'].includes(type) || string(header.subarray(157, 257))) throw new Error('UNSAFE_ARCHIVE_ENTRY');
        if (name !== prefix && !name.startsWith(`${prefix}/`)) throw new Error('INVALID_ARCHIVE_ROOT');
        if (name.includes('\\') || name.includes(':') || name.split('/').some(part => !part || part === '.' || part === '..') || names.has(name)) {
            throw new Error('UNSAFE_ARCHIVE_PATH');
        }
        names.add(name);
        const relative = name === prefix ? '' : name.slice(prefix.length + 1);
        const size = octal(header.subarray(124, 136));
        if (size > 64 * 1024 * 1024 || (type === '5' && size !== 0) || offset + 512 + size > tar.length) throw new Error('INVALID_ARCHIVE_SIZE');
        if (relative && !/^(backend|frontend|deploy)(\/|$)|^(release-manifest\.json|LICENSE|NOTICE)$/.test(relative)) throw new Error('UNEXPECTED_ARCHIVE_FILE');
        const target = path.join(destination, relative);
        if (!isWithin(destination, target)) throw new Error('UNSAFE_ARCHIVE_PATH');
        entries.push({ target, type, start: offset + 512, size });
        if (entries.length > 20000) throw new Error('TOO_MANY_ARCHIVE_FILES');
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (!entries.length || tar.length - offset < 1024) throw new Error('TRUNCATED_ARCHIVE');
    fs.mkdirSync(destination, { mode: 0o755 });
    try {
        for (const entry of entries) {
            if (entry.type === '5') fs.mkdirSync(entry.target, { recursive: true, mode: 0o755 });
            else {
                fs.mkdirSync(path.dirname(entry.target), { recursive: true, mode: 0o755 });
                fs.writeFileSync(entry.target, tar.subarray(entry.start, entry.start + entry.size), { flag: 'wx', mode: 0o644 });
            }
        }
        for (const required of ['release-manifest.json', 'backend/dist/sub-store.bundle.js', 'frontend/index.html']) {
            if (!fs.statSync(path.join(destination, required)).isFile()) throw new Error('INCOMPLETE_RELEASE_PACKAGE');
        }
    } catch (error) {
        fs.rmSync(destination, { recursive: true, force: true });
        throw error;
    }
}

module.exports = { extractRelease };
