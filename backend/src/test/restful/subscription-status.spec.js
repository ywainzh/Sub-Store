import { expect } from 'chai';
import { before, after, beforeEach, describe, it } from 'mocha';
import {
    SUBS_KEY,
    COLLECTIONS_KEY,
    FILES_KEY,
    TOKENS_KEY,
    SETTINGS_KEY,
} from '@/constants';

let $,
    openApi,
    status,
    flow,
    cache,
    produceArtifact,
    registerSubs,
    registerCols,
    registerDownloads,
    registerFiles,
    registerPreview;
let original, state, replies, requests, active, maxActive, delay;
const node = (name) =>
    `vless://11111111-1111-4111-8111-111111111111@1.1.1.1:443?security=tls&type=ws&host=example.com#${name}`;
const local = (name) => ({
    name,
    source: 'local',
    content: node(name),
    process: [],
});
const remote = (name, url = `https://example.com/${name}`) => ({
    name,
    source: 'remote',
    url,
    process: [],
});
const healthy = 'upload=10; download=20; total=100; expire=4115721600';
const exhausted = 'upload=20; download=80; total=100; expire=4115721600';

function appRoutes(register) {
    const handlers = new Map();
    const app = {
        route(path) {
            const chain = {};
            for (const method of ['get', 'post', 'patch', 'put', 'delete'])
                chain[method] = (fn) => {
                    handlers.set(`${method} ${path}`, fn);
                    return chain;
                };
            return chain;
        },
    };
    for (const method of ['get', 'post', 'patch', 'put', 'delete'])
        app[method] = (path, fn) => {
            handlers.set(`${method} ${path}`, fn);
            return app;
        };
    register(app);
    return handlers;
}

async function request(
    register,
    method,
    path,
    { name = 'A', body = {}, query = {} } = {},
) {
    const res = {
        statusCode: 200,
        headers: {},
        req: { route: { path } },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        },
        send(value) {
            this.body = value;
            return this;
        },
        set(key, value) {
            this.headers[key] = value;
            return this;
        },
        getHeaders() {
            return this.headers;
        },
        removeHeader(key) {
            delete this.headers[key];
        },
    };
    await appRoutes(register).get(`${method} ${path}`)(
        {
            params: { name },
            query: { target: 'JSON', ...query },
            body,
            headers: {},
            path,
            method: method.toUpperCase(),
            url: path,
        },
        res,
    );
    return res;
}

describe('subscription availability and automatic recovery', function () {
    before(function () {
        $ = require('@/core/app').default;
        openApi = require('@/vendor/open-api');
        status = require('@/utils/subscription-status');
        flow = require('@/utils/flow');
        cache = require('@/utils/headers-resource-cache').default;
        ({ produceArtifact } = require('@/utils/produce-artifact'));
        registerSubs = require('@/restful/subscriptions').default;
        registerCols = require('@/restful/collections').default;
        registerDownloads = require('@/restful/download').default;
        registerFiles = require('@/restful/file').default;
        registerPreview = require('@/restful/preview').default;
        original = {
            read: $.read,
            write: $.write,
            info: $.info,
            error: $.error,
            notify: $.notify,
            HTTP: openApi.HTTP,
            now: Date.now,
        };
    });
    after(function () {
        for (const key of ['read', 'write', 'info', 'error', 'notify'])
            $[key] = original[key];
        openApi.HTTP = original.HTTP;
        Date.now = original.now;
    });
    beforeEach(function () {
        Date.now = original.now;
        state = {
            [SUBS_KEY]: [remote('A'), local('B'), local('C')],
            [COLLECTIONS_KEY]: [
                { name: 'group', subscriptions: ['A', 'B', 'C'], process: [] },
            ],
            [FILES_KEY]: [],
            [TOKENS_KEY]: [
                {
                    token: 'existing-share',
                    payload: { type: 'col', name: 'group' },
                },
            ],
            [SETTINGS_KEY]: {},
        };
        replies = new Map();
        requests = [];
        active = 0;
        maxActive = 0;
        delay = null;
        $.read = (key) => state[key];
        $.write = (value, key) => {
            state[key] = value;
        };
        $.info = $.error = $.notify = () => {};
        cache.revokeAll();
        require('@/utils/resource-cache').default.revokeAll();
        const http = async (method, options) => {
            requests.push({ method, url: options.url });
            active++;
            maxActive = Math.max(maxActive, active);
            try {
                if (delay) await delay(options);
                const reply = replies.get(options.url) || {};
                if (reply.error) throw new Error('network failed');
                return {
                    statusCode: reply.status || 200,
                    headers: {
                        'subscription-userinfo':
                            reply.headers === undefined
                                ? healthy
                                : reply.headers,
                    },
                    body: reply.body || node(options.url.split('/').pop()),
                };
            } finally {
                active--;
            }
        };
        openApi.HTTP = () => ({
            head: (options) => http('HEAD', options),
            get: (options) => http('GET', options),
        });
    });

    it('defaults old remote subscriptions to automatic management and local ones to manual only', function () {
        expect(status.normalizeAvailabilityConfig(remote('A'))).to.include({
            enabled: true,
            autoManage: true,
        });
        expect(status.normalizeAvailabilityConfig(local('B'))).to.include({
            enabled: true,
            autoManage: false,
        });
        expect(() =>
            status.normalizeAvailabilityConfig({
                ...remote('A'),
                enabled: 'false',
            }),
        ).to.throw();
        const item = status.normalizeAvailabilityConfig({
            ...remote('A'),
            availability: { active: false },
            active: false,
        });
        expect(item).not.to.have.property('availability');
        expect(item).not.to.have.property('active');
    });

    it('pauses at exactly zero remaining traffic and recovers after a fresh reset', async function () {
        replies.set('https://example.com/A', { headers: exhausted });
        const stopped = await status.checkSubscription('A');
        expect(stopped).to.include({
            active: false,
            enabled: true,
            reason: 'exhausted',
        });
        replies.set('https://example.com/A', { headers: healthy });
        expect((await status.checkSubscription('A')).active).to.equal(false);
        expect(
            (await status.checkSubscription('A', { force: true })).active,
        ).to.equal(true);
        expect(state[SUBS_KEY][0]).not.to.have.property('enabled');
        expect(requests).to.have.length(2);
    });

    it('recognizes expiry-only metadata, including a configured flow URL', async function () {
        state[SUBS_KEY][0].subUserinfo = 'https://example.com/info';
        replies.set('https://example.com/info', {
            body: 'expire=1',
            headers: '',
        });
        const expired = await status.checkSubscription('A');
        expect(expired.reason).to.equal('expired');
        expect(expired.sources[0].flow.expires).to.equal(1);
        replies.set('https://example.com/info', {
            body: 'expire=4115721600',
            headers: '',
        });
        expect(
            (await status.checkSubscription('A', { force: true })).active,
        ).to.equal(true);
    });

    it('retains restrictions on missing data, bad numbers, HTTP errors and network failure', async function () {
        replies.set('https://example.com/A', { headers: exhausted });
        await status.checkSubscription('A');
        for (const reply of [
            { headers: '' },
            { headers: 'upload=-1; download=0; total=100' },
            { headers: 'upload=0; download=0; total=0' },
            { status: 403, headers: healthy },
            { error: true },
        ]) {
            replies.set('https://example.com/A', reply);
            expect(
                (await status.checkSubscription('A', { force: true })).reason,
            ).to.equal('exhausted');
        }
    });

    it('does not pause unknown subscriptions or treat missing counters as exhausted', async function () {
        for (const headers of [
            '',
            'total=10; download=20',
            'upload=NaN; download=20; total=10',
            'upload=1; download=Infinity; total=10',
            'upload=1; download=20; total=0',
        ]) {
            replies.set('https://example.com/A', { headers });
            expect(
                (await status.checkSubscription('A', { force: true })).active,
            ).to.equal(true);
        }
    });

    it('honors known expiry even if the provider is temporarily unavailable', async function () {
        const now = Date.now();
        replies.set('https://example.com/A', {
            headers: `upload=0; download=1; total=10; expire=${
                Math.floor(now / 1000) + 5
            }`,
        });
        await status.checkSubscription('A');
        Date.now = () => now + 10000;
        replies.set('https://example.com/A', { error: true });
        expect(
            (await status.checkSubscription('A', { force: true })).reason,
        ).to.equal('expired');
    });

    it('rechecks automatically stopped sources after 30 minutes without checking manual stops', async function () {
        const now = Date.now();
        replies.set('https://example.com/A', { headers: exhausted });
        await status.checkAllSubscriptions();
        replies.set('https://example.com/A', { headers: healthy });
        await status.checkAllSubscriptions();
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).reason,
        ).to.equal('exhausted');
        Date.now = () => now + status.CHECK_INTERVAL + 1000;
        await status.checkAllSubscriptions();
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).active,
        ).to.equal(true);
        state[SUBS_KEY][0].enabled = false;
        const before = requests.length;
        Date.now = () => now + status.CHECK_INTERVAL * 2 + 2000;
        await status.checkAllSubscriptions();
        expect(requests).to.have.length(before);
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).reason,
        ).to.equal('manual');
    });

    it('keeps manual shutdown across checks and reloads persisted state', async function () {
        replies.set('https://example.com/A', { headers: exhausted });
        await status.checkSubscription('A');
        state = JSON.parse(JSON.stringify(state));
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).reason,
        ).to.equal('exhausted');
        state[SUBS_KEY][0].enabled = false;
        requests.length = 0;
        await status.checkAllSubscriptions();
        expect(requests).to.have.length(0);
        replies.set('https://example.com/A', { headers: healthy });
        expect(
            (await status.checkSubscription('A', { force: true, manual: true }))
                .reason,
        ).to.equal('manual');
    });

    it('retains B and C with the original group and token after A stops', async function () {
        state[SUBS_KEY][0].enabled = false;
        const before = JSON.stringify([
            state[COLLECTIONS_KEY],
            state[TOKENS_KEY],
        ]);
        const output = await produceArtifact({
            type: 'collection',
            name: 'group',
            platform: 'JSON',
        });
        expect(JSON.parse(output).map((item) => item.name)).to.deep.equal([
            'B',
            'C',
        ]);
        expect(
            JSON.stringify([state[COLLECTIONS_KEY], state[TOKENS_KEY]]),
        ).to.equal(before);
        const shared = await request(
            registerDownloads,
            'get',
            '/share/col/:name',
            { name: 'group', query: { noFlow: true } },
        );
        expect(shared.statusCode).to.equal(200);
        expect(JSON.parse(shared.body).map((item) => item.name)).to.deep.equal([
            'B',
            'C',
        ]);
        expect(
            status.getCollectionStatus(state[COLLECTIONS_KEY][0])
                .firstAvailable,
        ).to.equal('B');
    });

    it('filters expired URLs individually and preserves mixed local content', async function () {
        state[SUBS_KEY][0] = {
            ...remote(
                'A',
                'https://example.com/expired\nhttps://example.com/good',
            ),
            mergeSources: 'localFirst',
            content: node('local-part'),
        };
        replies.set('https://example.com/expired', { headers: 'expire=1' });
        const output = JSON.parse(
            await produceArtifact({
                type: 'subscription',
                name: 'A',
                platform: 'JSON',
            }),
        );
        expect(output.map((item) => item.name)).to.deep.equal([
            'local-part',
            'good',
        ]);
        expect(status.getSubscriptionStatus(state[SUBS_KEY][0])).to.include({
            active: true,
            partial: true,
            availableSources: 2,
            sourceCount: 3,
        });
        expect(
            requests.some(
                (item) =>
                    item.method === 'GET' && item.url.endsWith('/expired'),
            ),
        ).to.equal(false);
    });

    it('forwards flow metadata from the first active member instead of an expired first member', async function () {
        state[SUBS_KEY][1] = remote('B');
        replies.set('https://example.com/A', {
            headers: 'upload=10; download=20; total=100; expire=1',
        });
        const response = await request(
            registerDownloads,
            'get',
            '/download/collection/:name',
            { name: 'group' },
        );
        expect(response.statusCode).to.equal(200);
        expect(response.headers['subscription-userinfo']).to.include(
            'expire=4115721600',
        );
        expect(
            JSON.parse(response.body).map((item) => item.name),
        ).to.deep.equal(['B', 'C']);
    });

    it('rejects direct, shared and raw downloads despite fallback and noFlow overrides', async function () {
        state[SUBS_KEY][0].enabled = false;
        state[SUBS_KEY][0].ignoreFailedRemoteSub = 'fallbackQuiet';
        for (const path of ['/download/:name', '/share/sub/:name']) {
            const res = await request(registerDownloads, 'get', path, {
                query: {
                    noFlow: true,
                    produceType: 'raw',
                    ignoreFailedRemoteSub: 'fallbackQuiet',
                    ...(path.startsWith('/download')
                        ? { content: node('override') }
                        : {}),
                },
            });
            expect(res.statusCode).to.equal(409);
            expect(res.body.error.code).to.equal('SUBSCRIPTION_DISABLED');
        }
        state[SUBS_KEY].forEach((sub) => {
            sub.enabled = false;
        });
        state[COLLECTIONS_KEY][0].ignoreFailedRemoteSub = 'fallbackQuiet';
        const empty = await request(
            registerDownloads,
            'get',
            '/download/collection/:name',
            { name: 'group' },
        );
        expect(empty.statusCode).to.equal(409);
        expect(empty.body.error.code).to.equal('NO_ACTIVE_SUBSCRIPTIONS');
    });

    it('does not let a noFlow query bypass automatic shutdown', async function () {
        replies.set('https://example.com/A', { headers: exhausted });
        const res = await request(registerDownloads, 'get', '/download/:name', {
            query: { noFlow: true, ignoreFailedRemoteSub: 'fallbackQuiet' },
        });
        expect(res.statusCode).to.equal(409);
        expect(res.body.error.code).to.equal('SUBSCRIPTION_DISABLED');
        expect(requests.map((item) => item.method)).to.deep.equal(['HEAD']);
    });

    it('applies tag selection and the same rules to preview and file node injection', async function () {
        state[SUBS_KEY][0].enabled = false;
        state[SUBS_KEY].forEach((sub) => {
            sub.tag = ['all'];
        });
        state[COLLECTIONS_KEY][0].subscriptions = [];
        state[COLLECTIONS_KEY][0].subscriptionTags = ['all'];
        const preview = await request(
            registerPreview,
            'post',
            '/api/preview/collection',
            { body: state[COLLECTIONS_KEY][0] },
        );
        expect(
            preview.body.data.processed.map((item) => item.name),
        ).to.deep.equal(['B', 'C']);
        state[FILES_KEY] = [
            {
                name: 'config',
                type: 'mihomoConfig',
                sourceType: 'local',
                content: 'mode: rule\nproxies: []',
                process: [
                    {
                        type: 'Add Proxies From Subscription Operator',
                        args: { sourceType: 'collection', sourceName: 'group' },
                    },
                ],
            },
        ];
        const output = await produceArtifact({ type: 'file', name: 'config' });
        expect(output)
            .to.include('name: B')
            .and.include('name: C')
            .and.not.include('name: A');
        state[SUBS_KEY].forEach((sub) => {
            sub.enabled = false;
        });
        const res = await request(registerFiles, 'get', '/api/file/:name', {
            name: 'config',
        });
        expect(res.statusCode).to.equal(409);
    });

    it('allows administrator preview of a manually stopped single subscription', async function () {
        state[SUBS_KEY][1].enabled = false;
        const res = await request(registerPreview, 'post', '/api/preview/sub', {
            body: state[SUBS_KEY][1],
        });
        expect(res.statusCode).to.equal(200);
        expect(res.body.data.processed[0].name).to.equal('B');
    });

    it('re-evaluates file references instead of serving disabled nodes from an optimistic cache', async function () {
        state[SUBS_KEY][0] = remote(
            'A',
            '/api/file/config#cacheKey=availability-test-cache',
        );
        state[SUBS_KEY][1].enabled = false;
        state[COLLECTIONS_KEY][0].subscriptions = ['B', 'C'];
        state[FILES_KEY] = [
            {
                name: 'config',
                type: 'mihomoConfig',
                sourceType: 'collection',
                sourceName: 'group',
                content: 'mode: rule',
                process: [],
            },
        ];
        state['#sub-store-cached-custom-availability-test-cache'] = node('B');
        const output = await produceArtifact({
            type: 'subscription',
            name: 'A',
            platform: 'JSON',
            awaitCustomCache: true,
        });
        expect(JSON.parse(output).map((item) => item.name)).to.deep.equal([
            'C',
        ]);
    });

    it('makes status reads local and merges simultaneous force checks', async function () {
        delay = () => new Promise((resolve) => setTimeout(resolve, 5));
        const read = await request(registerSubs, 'get', '/api/subs/status');
        expect(read.statusCode).to.equal(200);
        expect(requests).to.have.length(0);
        await Promise.all(
            Array.from({ length: 4 }, () =>
                status.checkSubscription('A', { force: true }),
            ),
        );
        expect(requests).to.have.length(1);
        state[SUBS_KEY] = Array.from({ length: 6 }, (_, i) =>
            remote(`remote-${i}`),
        );
        await status.checkAllSubscriptions();
        expect(maxActive).to.equal(2);
    });

    it('shares concurrent checks of the same source across different URL lists', async function () {
        state[SUBS_KEY][1] = remote(
            'B',
            'https://example.com/A\nhttps://example.com/B',
        );
        delay = () => new Promise((resolve) => setTimeout(resolve, 5));
        await Promise.all(
            ['A', 'B'].map((name) => status.checkSubscription(name)),
        );
        expect(
            requests.filter((item) => item.url === 'https://example.com/A'),
        ).to.have.length(1);
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][1]).availableSources,
        ).to.equal(2);
    });

    it('keeps healthy URL variants when only one variant has expired metadata', async function () {
        const expiredUrl =
            'https://example.com/A#flowUrl=https%3A%2F%2Fexample.com%2Fexpired';
        const healthyUrl =
            'https://example.com/A#flowUrl=https%3A%2F%2Fexample.com%2Fhealthy';
        state[SUBS_KEY][0].url = `${expiredUrl}\n${healthyUrl}`;
        replies.set('https://example.com/expired', {
            headers: '',
            body: 'expire=1',
        });
        replies.set('https://example.com/healthy', {
            headers: '',
            body: healthy,
        });
        await status.checkSubscription('A');
        expect(
            status.availableSubscriptionUrls(state[SUBS_KEY][0]),
        ).to.deep.equal([healthyUrl]);
    });

    it('returns 400 for invalid availability fields on create and replacement', async function () {
        for (const [register, route, body] of [
            [registerSubs, '/api/subs', { ...remote('new'), enabled: 'false' }],
            [
                registerCols,
                '/api/collections',
                { name: 'new', subscriptions: [], enabled: 0 },
            ],
        ]) {
            expect(
                (await request(register, 'post', route, { body })).statusCode,
            ).to.equal(400);
            expect(
                (await request(register, 'put', route, { body: [body] }))
                    .statusCode,
            ).to.equal(400);
        }
    });

    it('honors a collection switch changed while a source is downloading', async function () {
        let release;
        let entered;
        const started = new Promise((resolve) => {
            entered = resolve;
        });
        await status.checkSubscription('A');
        delay = () => {
            entered();
            return new Promise((resolve) => {
                release = resolve;
            });
        };
        const downloading = request(
            registerDownloads,
            'get',
            '/download/collection/:name',
            { name: 'group', query: { noFlow: true } },
        );
        await started;
        await request(registerCols, 'patch', '/api/collection/:name', {
            name: 'group',
            body: { enabled: false },
        });
        release();
        expect((await downloading).statusCode).to.equal(409);
    });

    it('excludes a member switched off during download without interrupting other members', async function () {
        let release;
        let entered;
        const started = new Promise((resolve) => {
            entered = resolve;
        });
        await status.checkSubscription('A');
        delay = () => {
            entered();
            return new Promise((resolve) => {
                release = resolve;
            });
        };
        const downloading = request(
            registerDownloads,
            'get',
            '/download/collection/:name',
            { name: 'group', query: { noFlow: true } },
        );
        await started;
        await request(registerSubs, 'patch', '/api/sub/:name', {
            body: { enabled: false },
        });
        release();
        const result = await downloading;
        expect(result.statusCode).to.equal(200);
        expect(JSON.parse(result.body).map((item) => item.name)).to.deep.equal([
            'B',
            'C',
        ]);
    });

    it('discards a slow result after a PATCH or a source change', async function () {
        let release;
        let entered;
        const started = new Promise((resolve) => {
            entered = resolve;
        });
        delay = () => {
            entered();
            return new Promise((resolve) => {
                release = resolve;
            });
        };
        replies.set('https://example.com/A', { headers: exhausted });
        const checking = status.checkSubscription('A');
        await started;
        await request(registerSubs, 'patch', '/api/sub/:name', {
            body: { enabled: false, url: 'https://example.com/new' },
        });
        release();
        await checking;
        const current = status.getSubscriptionStatus(state[SUBS_KEY][0]);
        expect(current.reason).to.equal('manual');
        expect(current.sources[0].checkedAt).to.equal(null);
    });

    it('preserves decisions on rename and prunes them after deletion', async function () {
        replies.set('https://example.com/A', { headers: exhausted });
        await status.checkSubscription('A');
        const renamed = await request(registerSubs, 'patch', '/api/sub/:name', {
            body: { name: 'renamed' },
        });
        expect(renamed.statusCode).to.equal(200);
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).reason,
        ).to.equal('exhausted');
        await request(registerSubs, 'delete', '/api/sub/:name', {
            name: 'renamed',
        });
        expect(JSON.parse(state[status.SUBS_STATUS_KEY])).to.deep.equal({});
    });

    it('allows explicit opt-out, while preserving manual shutdown and noFlow requests', async function () {
        state[SUBS_KEY][0].noFlow = true;
        expect((await status.checkSubscription('A')).active).to.equal(true);
        expect(requests).to.have.length(0);
        delete state[SUBS_KEY][0].noFlow;
        replies.set('https://example.com/A', { headers: exhausted });
        await status.checkSubscription('A', { force: true });
        await request(registerSubs, 'patch', '/api/sub/:name', {
            body: { autoManage: false },
        });
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).active,
        ).to.equal(true);
        await request(registerSubs, 'patch', '/api/sub/:name', {
            body: { enabled: false },
        });
        expect(
            status.getSubscriptionStatus(state[SUBS_KEY][0]).reason,
        ).to.equal('manual');
    });
});
