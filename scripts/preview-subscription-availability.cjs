'use strict';
// Local UI acceptance fixture. All subscriptions and provider responses are synthetic.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-availability-ui-'));
const data = path.join(temporary, 'data');
fs.mkdirSync(data);
const node = name => `vless://11111111-1111-4111-8111-111111111111@127.0.0.1:443?security=tls&type=ws&host=example.com#${encodeURIComponent(name)}`;
let expired = true;
let child;
let closing = false;
const provider = http.createServer((req, res) => {
    if (req.url === '/renew' && req.method === 'POST') { expired = false; res.end('renewed'); return; }
    if (req.url === '/stop' && req.method === 'POST') { res.end('stopping'); void stop(); return; }
    const name = req.url === '/expired' ? '远程-到期' : '远程-正常';
    const expires = name === '远程-到期' && expired ? 1 : 4115721600;
    res.setHeader('subscription-userinfo', `upload=1048576; download=5368709120; total=21474836480; expire=${expires}`);
    res.end(node(name));
});
async function stop() {
    if (closing) return;
    closing = true;
    if (child && child.exitCode === null) {
        const stopped = new Promise(resolve => child.once('exit', resolve));
        child.kill(); await stopped;
    }
    provider.close();
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('sub-store-availability-ui-')) fs.rmSync(resolved, { recursive: true, force: true });
}
async function start() {
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    const providerBase = `http://127.0.0.1:${provider.address().port}`;
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    fs.writeFileSync(path.join(data, 'sub-store.json'), JSON.stringify({
        schemaVersion: '2.0',
        subs: [
            { name: '本地-A', source: 'local', content: node('本地-A'), process: [] },
            { name: '本地-B', source: 'local', content: node('本地-B'), process: [] },
            { name: '远程-正常', source: 'remote', url: `${providerBase}/healthy`, process: [] },
            { name: '远程-到期', source: 'remote', url: `${providerBase}/expired`, process: [] },
        ],
        collections: [{ name: '验收组合', subscriptions: ['远程-到期', '远程-正常', '本地-A', '本地-B'], process: [] }],
        files: [], artifacts: [], tokens: [], rules: [], settings: {},
    }));
    child = spawn(process.execPath, [path.join(root, 'backend/dist/sub-store.bundle.js')], {
        cwd: data, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, NODE_ENV: 'development',
            SUB_STORE_DATA_BASE_PATH: data, SUB_STORE_AUTH_ENABLED: 'false', SUB_STORE_ONLINE_MANAGEMENT: 'false',
            SUB_STORE_RELEASE_MANIFEST: '', SUB_STORE_BACKEND_API_HOST: '127.0.0.1', SUB_STORE_BACKEND_API_PORT: String(port),
            SUB_STORE_BACKEND_MERGE: 'ON', SUB_STORE_BACKEND_PREFIX: '', SUB_STORE_FRONTEND_BACKEND_PATH: '/',
            SUB_STORE_FRONTEND_PATH: path.join(root, 'frontend-local/dist'), SUB_STORE_PUBLIC_ORIGIN: base, SUB_STORE_CORS_ALLOWED_ORIGINS: base,
        },
    });
    let logs = '';
    child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Preview exited: ${logs}`);
        try {
            if ((await fetch(`${base}/api/health`)).ok) {
                console.log(JSON.stringify({ previewUrl: `${base}/subs`, providerBase, temporary }));
                return;
            }
        } catch { /* Wait for the local bundle. */ }
        await delay(150);
    }
    throw new Error(`Preview did not start: ${logs}`);
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
start().catch(async error => { console.error(error.message); await stop(); process.exitCode = 1; });
