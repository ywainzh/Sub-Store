'use strict';

const { REPOSITORY, assertTag, validateManifest, sha256 } = require('./contract.cjs');

const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

async function fetchBytes(url, { maxBytes = 2 * 1024 * 1024, timeout = 15000, fetchImpl = fetch } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        for (let redirects = 0; redirects <= 5; redirects++) {
            const target = new URL(url);
            if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname) || target.port || target.username || target.password) {
                throw new Error('UNTRUSTED_RELEASE_URL');
            }
            const response = await fetchImpl(target, {
                signal: controller.signal, redirect: 'manual',
                headers: { 'User-Agent': 'Sub-Store-Release-Manager/1', Accept: 'application/vnd.github+json' },
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                await response.body?.cancel();
                url = new URL(response.headers.get('location'), target).href;
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error(`RELEASE_HTTP_${response.status}`);
            }
            if (Number(response.headers.get('content-length')) > maxBytes) {
                await response.body?.cancel();
                throw new Error('RELEASE_FILE_TOO_LARGE');
            }
            const chunks = [];
            let size = 0;
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > maxBytes) throw new Error('RELEASE_FILE_TOO_LARGE');
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        }
        throw new Error('TOO_MANY_RELEASE_REDIRECTS');
    } finally { clearTimeout(timer); }
}

function parseChecksums(text) {
    const checksums = new Map();
    for (const line of text.trim().split(/\r?\n/)) {
        const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
        if (!match || checksums.has(match[2])) throw new Error('INVALID_RELEASE_CHECKSUMS');
        checksums.set(match[2], match[1]);
    }
    return checksums;
}

function createReleaseCatalog({ getBytes = fetchBytes, now = Date.now } = {}) {
    const cache = new Map();
    const ttl = 5 * 60 * 1000;
    const cached = async (key, loader) => {
        const entry = cache.get(key);
        if (entry && entry.expires > now()) return entry.value;
        const value = await loader();
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expires: now() + ttl });
        return value;
    };
    async function fromRelease(release) {
        const tag = assertTag(release.tag_name);
        const archiveName = `sub-store-server-${tag}.tar.gz`;
        if (release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) {
            throw new Error('NOT_A_STABLE_RELEASE');
        }
        for (const name of [archiveName, 'release-manifest.json', 'checksums.txt']) {
            if (!release.assets.some(asset => asset.name === name && asset.size > 0 && asset.state === 'uploaded')) {
                throw new Error('INCOMPLETE_RELEASE');
            }
        }
        return cached(`manifest:${tag}`, async () => {
            const baseUrl = `https://github.com/${REPOSITORY}/releases/download/${tag}`;
            const [manifestBytes, checksumBytes] = await Promise.all([
                getBytes(`${baseUrl}/release-manifest.json`, { maxBytes: 64 * 1024 }),
                getBytes(`${baseUrl}/checksums.txt`, { maxBytes: 16 * 1024 }),
            ]);
            const checksums = parseChecksums(checksumBytes.toString('utf8'));
            if (checksums.get('release-manifest.json') !== sha256(manifestBytes) || !checksums.has(archiveName)) {
                throw new Error('RELEASE_CHECKSUM_MISMATCH');
            }
            const manifest = validateManifest(JSON.parse(manifestBytes), tag);
            return {
                tag, manifest, notes: String(release.body || '').slice(0, 16000),
                publishedAt: release.published_at || null,
                url: `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
                archiveUrl: `${baseUrl}/${archiveName}`, archiveSha256: checksums.get(archiveName),
                manifestSha256: checksums.get('release-manifest.json'), local: false,
            };
        });
    }
    return {
        async get(tag) {
            assertTag(tag);
            return cached(`tag:${tag}`, async () => {
                const release = JSON.parse(await getBytes(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`));
                return fromRelease(release);
            });
        },
        async list(page = 1) {
            if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('INVALID_RELEASE_PAGE');
            return cached(`page:${page}`, async () => {
                const releases = JSON.parse(await getBytes(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=10&page=${page}`));
                if (!Array.isArray(releases)) throw new Error('INVALID_RELEASE_RESPONSE');
                const versions = [];
                // Bound concurrent asset requests and ignore incompatible/unfinished releases.
                for (let index = 0; index < releases.length; index += 3) {
                    const results = await Promise.allSettled(releases.slice(index, index + 3).map(fromRelease));
                    for (const result of results) {
                        if (result.status === 'fulfilled') versions.push(result.value);
                        else if (/RELEASE_HTTP_|fetch failed|abort|timeout/i.test(result.reason?.message || '')) throw result.reason;
                    }
                }
                return { versions, nextPage: releases.length === 10 ? page + 1 : null };
            });
        },
    };
}

module.exports = { fetchBytes, parseChecksums, createReleaseCatalog };
