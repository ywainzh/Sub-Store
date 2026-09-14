'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createServer } = require('vite');

let server;
let getSharePublicUrl;

before(async () => {
  const root = path.resolve(__dirname, '..');
  server = await createServer({
    configFile: false,
    root,
    resolve: { alias: { '@': path.join(root, 'src') } },
    server: { middlewareMode: true },
    optimizeDeps: { disabled: true },
  });
  ({ getSharePublicUrl } = await server.ssrLoadModule('/src/utils/share.ts'));
});

after(async () => { await server?.close(); });

const share = { type: 'file', name: '分享 / Clash', token: 'test-only+token&value' };
const sharePath = `/share/file/${encodeURIComponent(share.name)}?token=${encodeURIComponent(share.token)}`;

for (const secretPath of [undefined, null, '', '/']) {
  test(`root deployment builds a full share URL with path ${JSON.stringify(secretPath)}`, () => {
    assert.equal(getSharePublicUrl({ ...share, host: 'https://sub.example.com/', secretPath }),
      `https://sub.example.com${sharePath}`);
  });
}

for (const host of ['https://sub.example.com/gateway', 'https://sub.example.com/gateway/']) {
  for (const secretPath of ['/gateway', '/gateway/']) {
    test(`removes the backend prefix from ${host} with path ${secretPath}`, () => {
      assert.equal(getSharePublicUrl({ ...share, host, secretPath }),
        `https://sub.example.com${sharePath}`);
    });
  }
}

test('preserves a reverse proxy base path outside the backend prefix', () => {
  assert.equal(getSharePublicUrl({ ...share, host: 'https://sub.example.com/proxy/gateway/', secretPath: '/gateway' }),
    `https://sub.example.com/proxy${sharePath}`);
});

test('uses the configured public share server without requiring backend metadata', () => {
  assert.equal(getSharePublicUrl({ ...share, host: 'https://admin.example.com/gateway', secretPath: '', shareBaseUrl: ' https://public.example.com/proxy/// ' }),
    `https://public.example.com/proxy${sharePath}`);
});

test('rejects an explicitly malformed backend path', () => {
  assert.throws(() => getSharePublicUrl({ ...share, host: 'https://sub.example.com', secretPath: 'gateway' }),
    /INVALID_SECRET_PATH/);
});

test('keeps public share URL overrides independent of the backend path', () => {
  assert.equal(getSharePublicUrl({ ...share, host: 'https://admin.example.com', secretPath: 'gateway', shareBaseUrl: 'https://public.example.com/' }),
    `https://public.example.com${sharePath}`);
});
