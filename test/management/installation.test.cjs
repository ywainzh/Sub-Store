'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyShares } = require('../../deploy/install.cjs');

test('migration verifies valid shares without consuming count-limited or expired tokens', async t => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-install-test-'));
    t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dataDirectory, 'sub-store.json'), JSON.stringify({ tokens: [
        { type: 'sub', name: 'limited', token: 'synthetic-limited', mode: 'count', count: 2, usedCount: 0 },
        { type: 'sub', name: 'expired', token: 'synthetic-expired', exp: Date.now() - 1000 },
        { type: 'file', name: 'active', token: 'synthetic-active' },
    ] }));
    const requested = [];
    const count = await verifyShares({ dataDirectory, port: 3000 }, async url => {
        requested.push(new URL(url).pathname);
        return new Response('synthetic configuration');
    });
    assert.equal(count, 1);
    assert.deepEqual(requested, ['/share/file/active']);
});
