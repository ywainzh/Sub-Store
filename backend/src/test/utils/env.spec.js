import { expect } from 'chai';
import { describe, it } from 'mocha';

function loadEnv(overrides) {
    const filename = require.resolve('../../utils/env');
    const cached = require.cache[filename];
    const original = new Map(
        Object.keys(overrides).map(key => [key, process.env[key]]),
    );
    try {
        for (const [key, value] of Object.entries(overrides)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        delete require.cache[filename];
        return require('../../utils/env').default;
    } finally {
        for (const [key, value] of original) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        if (cached) require.cache[filename] = cached;
        else delete require.cache[filename];
    }
}

describe('public environment metadata', function () {
    for (const backendPath of ['/', '/gateway']) {
        it(`preserves the ${backendPath} routing path needed by share links`, function () {
            const env = loadEnv({
                SUB_STORE_RELEASE_MANIFEST: undefined,
                SUB_STORE_FRONTEND_BACKEND_PATH: backendPath,
                SUB_STORE_BACKEND_CUSTOM_NAME: 'Share test',
                SUB_STORE_DOCKER: 'true',
                SUB_STORE_AUTH_FILE: '/private/auth.json',
                SUB_STORE_AUTH_SESSIONS_FILE: '/private/sessions.json',
                SUB_STORE_DEPLOY_DIRECTORY: '/private/deploy',
                SUB_STORE_DATA_BASE_PATH: '/private/data',
                SUB_STORE_FRONTEND_PATH: '/private/frontend',
                SUB_STORE_TEST_SECRET: 'test-only-secret',
            });

            expect(env.meta.node.env).to.deep.equal({
                SUB_STORE_BACKEND_CUSTOM_NAME: 'Share test',
                SUB_STORE_DOCKER: 'true',
                SUB_STORE_FRONTEND_BACKEND_PATH: backendPath,
            });
            expect(env.meta.node).to.not.have.property('argv');
            expect(env.meta.node).to.not.have.property('filename');
            expect(env.meta.node).to.not.have.property('dirname');
        });
    }
});
