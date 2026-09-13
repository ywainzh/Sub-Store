'use strict';
const { assertTag, REPOSITORY } = require('../backend/src/management/contract.cjs');
(async () => {
    const tag = assertTag(process.env.RELEASE_TAG);
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`, {
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'Sub-Store-Release' },
        signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return;
    if (response.ok) throw new Error('A release already exists for this tag; published versions are immutable.');
    throw new Error(`Cannot check release existence: HTTP ${response.status}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
