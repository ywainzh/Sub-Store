'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReleaseCatalog, fetchBytes, parseChecksums } = require('../../backend/src/management/releases.cjs');
const { sha256 } = require('../../backend/src/management/contract.cjs');

const tag = 'v0.1.0';
const manifest = Buffer.from(JSON.stringify({
    formatVersion: 1, repository: 'ywainzh/Sub-Store', tag, commit: 'a'.repeat(40),
    versions: { backend: '2.39.6', frontend: '2.32.2' }, testedNode: '24.15.0',
    compatibility: { management: 1, auth: 1, data: { read: ['2.0'], write: '2.0' } },
}));
const release = {
    tag_name: tag, draft: false, prerelease: false, body: 'Release notes',
    assets: [`sub-store-server-${tag}.tar.gz`, 'release-manifest.json', 'checksums.txt'].map(name => ({ name, state: 'uploaded', size: 10 })),
};

test('catalog accepts only complete stable compatible releases and caches metadata', async () => {
    const calls = [];
    const catalog = createReleaseCatalog({ getBytes: async url => {
        calls.push(url);
        if (url.includes('/releases?')) return Buffer.from(JSON.stringify([release, { ...release, tag_name: 'v0.0.1', assets: [] }, { ...release, prerelease: true }]));
        if (url.endsWith('release-manifest.json')) return manifest;
        if (url.endsWith('checksums.txt')) return Buffer.from(`${'a'.repeat(64)}  sub-store-server-${tag}.tar.gz\n${sha256(manifest)}  release-manifest.json\n`);
        throw new Error('UNEXPECTED_REQUEST');
    } });
    const result = await catalog.list();
    assert.deepEqual(result.versions.map(item => item.tag), [tag]);
    const count = calls.length;
    await catalog.list(); assert.equal(calls.length, count);
    assert.ok(calls.every(url => url.startsWith('https://api.github.com/repos/ywainzh/Sub-Store/') || url.startsWith('https://github.com/ywainzh/Sub-Store/')));
});

test('unavailable release assets are reported as unavailable instead of an empty up-to-date list', async () => {
    const catalog = createReleaseCatalog({ getBytes: async url => {
        if (url.includes('/releases?')) return Buffer.from(JSON.stringify([release]));
        throw new Error('RELEASE_HTTP_503');
    } });
    await assert.rejects(catalog.list(), /RELEASE_HTTP_503/);
});

test('release requests do not send credentials and refuse untrusted redirects or oversized files', async () => {
    let calls = 0;
    await assert.rejects(fetchBytes('https://github.com/ywainzh/Sub-Store/releases/download/v0.1.0/test', { fetchImpl: async (url, options) => {
        calls++; assert.equal(options.headers.Authorization, undefined);
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    } }), /UNTRUSTED_RELEASE_URL/);
    assert.equal(calls, 1);
    await assert.rejects(fetchBytes('https://github.com/test', { maxBytes: 2, fetchImpl: async () => new Response('large') }), /RELEASE_FILE_TOO_LARGE/);
    assert.throws(() => parseChecksums(`${'a'.repeat(64)}  ../file`), /INVALID_RELEASE_CHECKSUMS/);
});
