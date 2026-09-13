'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('PWA activation completes while refreshed pages wait for the new worker', async () => {
    const navigated = [];
    let activate;
    let activation;
    const urls = ['/aboutUs', '/login', '/api/subs', '/download/demo', '/share/sub/demo'].map(route => 'https://sub.example.com' + route);
    urls.push('https://other.example.com/');
    const clients = urls.map(url => ({
        url,
        navigate(target) {
            navigated.push(target);
            // A page fetch can only complete after activation. Keep it pending
            // to expose an activation -> navigation -> activation deadlock.
            return new Promise(() => {});
        },
    }));
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../frontend-local/public/release-worker.js'), 'utf8'), {
        URL,
        self: { location: { origin: 'https://sub.example.com' }, clients: { matchAll: async () => clients }, addEventListener: (type, handler) => { if (type === 'activate') activate = handler; } },
    });
    activate({ waitUntil: promise => { activation = promise; } });
    let timer;
    try {
        await Promise.race([activation, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('ACTIVATION_WAITED_FOR_NAVIGATION')), 500); })]);
    } finally { clearTimeout(timer); }
    assert.deepEqual(navigated, ['https://sub.example.com/aboutUs', 'https://sub.example.com/login']);
});
