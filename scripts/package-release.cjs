'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTarGz } = require('./tar.cjs');
const { assertTag, validateManifest, REPOSITORY, sha256 } = require('../backend/src/management/contract.cjs');
const root = path.resolve(__dirname, '..');
const tag = assertTag(process.env.RELEASE_TAG);
const commit = process.env.RELEASE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const manifest = validateManifest({
    formatVersion: 1, repository: REPOSITORY, tag, commit,
    versions: { backend: require('../backend/package.json').version, frontend: require('../frontend-local/package.json').version },
    testedNode: fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim(),
    compatibility: { management: 1, auth: 1, data: { read: ['2.0'], write: '2.0' } },
}, tag);
const output = path.join(root, 'out');
fs.mkdirSync(output, { recursive: true });
const entries = [];
const add = (source, name) => entries.push({ name: `sub-store-server-${tag}/${name}`, bytes: fs.readFileSync(path.join(root, source)) });
function addTree(source, name) {
    for (const entry of fs.readdirSync(path.join(root, source), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) throw new Error('PACKAGE_SYMLINK_NOT_ALLOWED');
        if (entry.isDirectory()) addTree(`${source}/${entry.name}`, `${name}/${entry.name}`);
        else add(`${source}/${entry.name}`, `${name}/${entry.name}`);
    }
}
for (const name of ['sub-store.bundle.js', 'runtime-manifest.json', 'sub-store-0.min.js', 'sub-store-1.min.js', 'sub-store-parser.loon.min.js', 'proxy-utils.esm.mjs']) add(`backend/dist/${name}`, `backend/dist/${name}`);
addTree('frontend-local/dist', 'frontend');
add('frontend-local/LICENSE', 'frontend/LICENSE');
addTree('backend/src/management', 'backend/src/management');
addTree('deploy', 'deploy');
add('LICENSE', 'LICENSE');
add('NOTICE', 'NOTICE');
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
entries.push({ name: `sub-store-server-${tag}/release-manifest.json`, bytes: manifestBytes });
const archiveName = `sub-store-server-${tag}.tar.gz`;
const archive = createTarGz(entries);
fs.writeFileSync(path.join(output, archiveName), archive);
fs.writeFileSync(path.join(output, 'release-manifest.json'), manifestBytes);
fs.writeFileSync(path.join(output, 'checksums.txt'), `${sha256(archive)}  ${archiveName}\n${sha256(manifestBytes)}  release-manifest.json\n`);
console.log(`Packaged ${tag} (${commit}): ${archive.length} bytes`);
