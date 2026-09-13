'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '../backend');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-store-tests-'));
try {
    const result = spawnSync(process.execPath, [path.join(backend, 'node_modules/mocha/bin/mocha.js'), 'src/test/**/*.spec.js', '--require', '@babel/register', '--recursive'], {
        cwd: backend, stdio: 'inherit', env: {
            ...process.env, NODE_ENV: 'test', SUB_STORE_DATA_BASE_PATH: temporary,
            SUB_STORE_FRONTEND_BACKEND_PATH: '/', SUB_STORE_AUTH_ENABLED: 'false',
        },
    });
    process.exitCode = result.status ?? 1;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
