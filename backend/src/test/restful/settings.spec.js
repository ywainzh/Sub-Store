import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';

import $ from '@/core/app';
import { SETTINGS_KEY } from '@/constants';
import registerSettingsRoutes from '@/restful/settings';

function createRouteApp() {
    const handlers = new Map();
    const app = {
        handlers,
        route(pattern) {
            const chain = {};
            chain.get = (handler) => {
                handlers.set(`GET ${pattern}`, handler);
                return chain;
            };
            chain.patch = (handler) => {
                handlers.set(`PATCH ${pattern}`, handler);
                return chain;
            };
            return chain;
        },
    };

    return app;
}

function createResponse(routePath) {
    return {
        body: null,
        req: {
            route: {
                path: routePath,
            },
        },
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

describe('settings routes', function () {
    describe('appearance settings', function () {
        const originalRead = $.read.bind($);
        const originalWrite = $.write.bind($);

        afterEach(function () {
            $.read = originalRead;
            $.write = originalWrite;
        });

        async function patchSettings(initialSettings, body) {
            const state = {
                [SETTINGS_KEY]: initialSettings,
            };
            $.read = (key) => state[key];
            $.write = (data, key) => {
                state[key] = data;
                return true;
            };

            const app = createRouteApp();
            registerSettingsRoutes(app);
            const patchHandler = app.handlers.get('PATCH /api/settings');
            const res = createResponse('/api/settings');

            await patchHandler({ body }, res);

            expect(res.body.status).to.equal('success');
            return state[SETTINGS_KEY];
        }

        it('merges appearanceSetting patches without dropping unrelated fields', async function () {
            const settings = await patchSettings(
                {
                    appearanceSetting: {
                        isSimpleMode: false,
                        editorGroupingMode: 'always',
                        editorCommonDisplayMode: 'collapsed',
                    },
                },
                {
                    appearanceSetting: {
                        isSimpleMode: true,
                    },
                },
            );

            expect(settings.appearanceSetting).to.deep.equal({
                isSimpleMode: true,
                editorGroupingMode: 'always',
                editorCommonDisplayMode: 'collapsed',
            });
        });
    });

    describe('backend request concurrency settings', function () {
        const originalRead = $.read.bind($);
        const originalWrite = $.write.bind($);

        afterEach(function () {
            $.read = originalRead;
            $.write = originalWrite;
        });

        async function patchSettings(initialSettings, body) {
            const state = {
                [SETTINGS_KEY]: initialSettings,
            };
            $.read = (key) => state[key];
            $.write = (data, key) => {
                state[key] = data;
                return true;
            };

            const app = createRouteApp();
            registerSettingsRoutes(app);
            const patchHandler = app.handlers.get('PATCH /api/settings');
            const res = createResponse('/api/settings');

            await patchHandler({ body }, res);

            expect(res.body.status).to.equal('success');
            return state[SETTINGS_KEY];
        }

        it('persists positive integer backend request concurrency', async function () {
            const settings = await patchSettings(
                {},
                { backendRequestConcurrency: '15' },
            );

            expect(settings).to.deep.include({
                backendRequestConcurrency: '15',
            });
        });

        it('allows backend request concurrency above proxy app guidance', async function () {
            const settings = await patchSettings(
                {},
                { backendRequestConcurrency: 21 },
            );

            expect(settings).to.deep.include({
                backendRequestConcurrency: 21,
            });
        });

        it('clears invalid backend request concurrency values', async function () {
            const invalidValues = ['', 'abc', '1.5', 0, -1, null];

            for (const value of invalidValues) {
                const settings = await patchSettings(
                    { backendRequestConcurrency: 8 },
                    { backendRequestConcurrency: value },
                );

                expect(settings).to.not.have.property(
                    'backendRequestConcurrency',
                );
            }
        });

        it('persists backend request concurrency wait time values', async function () {
            const zeroWaitSettings = await patchSettings(
                {},
                { backendRequestConcurrencyWaitTime: 0 },
            );
            const positiveWaitSettings = await patchSettings(
                {},
                { backendRequestConcurrencyWaitTime: '50' },
            );

            expect(zeroWaitSettings).to.deep.include({
                backendRequestConcurrencyWaitTime: 0,
            });
            expect(positiveWaitSettings).to.deep.include({
                backendRequestConcurrencyWaitTime: '50',
            });
        });

        it('clears invalid backend request concurrency wait time values', async function () {
            const invalidValues = ['', 'abc', '1.5', -1, null];

            for (const value of invalidValues) {
                const settings = await patchSettings(
                    { backendRequestConcurrencyWaitTime: 8 },
                    { backendRequestConcurrencyWaitTime: value },
                );

                expect(settings).to.not.have.property(
                    'backendRequestConcurrencyWaitTime',
                );
            }
        });
    });
});
