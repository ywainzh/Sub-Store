import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { before, beforeEach, afterEach, describe, it } from 'mocha';
import { COLLECTIONS_KEY, FILES_KEY, SETTINGS_KEY, SUBS_KEY } from '@/constants';

const script = fs.readFileSync(
    path.resolve(__dirname, '../../../../scripts/dynamic-region-groups.js'),
    'utf8',
);
const proxy = (name) => ({
    name, type: 'ss', server: 'example.com', port: 8388,
    cipher: 'aes-128-gcm', password: 'test-only',
});
const selectorNames = ['默认节点', '国外AI', 'YouTube', 'Pixiv', '游戏专用', '下载软件', '其他外网'];
const group = (config, name) => config['proxy-groups'].find((item) => item.name === name);
const groupNames = (config) => config['proxy-groups'].map((item) => item.name);
let $, ProxyUtils, produceArtifact, main, prepareRegionTemplate, original, state;

function fixture(names = ['US-one', '日本 東京', 'SG-one']) {
    return {
        mode: 'rule',
        proxies: names.map(proxy),
        dns: { enable: true, nameserver: ['https://dns.example.com/dns-query'] },
        'rule-providers': { demo: { type: 'http', behavior: 'domain', url: 'https://example.com/rules.yaml', path: './rules/demo.yaml' } },
        rules: ['RULE-SET,demo,国外AI', 'DOMAIN-SUFFIX,example.jp,日本网站', 'MATCH,默认节点'],
        'proxy-groups': [
            { name: '默认节点', type: 'select', proxies: ['全部节点', 'US美国', 'JP日本', 'HK香港', 'TW台湾', '国外AI', 'DIRECT'] },
            {
                name: '自动-全部节点', type: 'url-test', url: 'https://cp.cloudflare.com/generate_204',
                interval: 300, timeout: 3000, tolerance: 50, lazy: true, hidden: true,
                'max-failed-times': 3, 'empty-fallback': 'REJECT', 'include-all-proxies': true,
            },
            { name: '全部节点', type: 'select', proxies: ['自动-全部节点'], 'include-all-proxies': true, icon: 'https://example.com/world.png' },
            ...['US美国', 'JP日本', 'HK香港', 'TW台湾'].flatMap((name) => [
                { name: `自动-${name}`, type: 'url-test', filter: name.slice(0, 2), 'include-all-proxies': true },
                { name, type: 'select', proxies: [`自动-${name}`], filter: name.slice(0, 2), 'include-all-proxies': true },
            ]),
            ...selectorNames.slice(1).map((name) => ({ name, type: 'select', proxies: ['全部节点', 'US美国', 'JP日本', 'HK香港', 'DIRECT'] })),
            { name: '日本网站', type: 'select', proxies: ['JP日本'] },
            { name: '国内网站', type: 'select', proxies: ['DIRECT'] },
            { name: '广告过滤', type: 'select', proxies: ['REJECT', 'DIRECT'] },
        ],
    };
}

function expectValidReferences(config) {
    const names = groupNames(config);
    expect(new Set(names).size).to.equal(names.length);
    const available = new Set(['DIRECT', 'REJECT', ...names, ...config.proxies.map((item) => item.name)]);
    for (const item of config['proxy-groups']) {
        for (const reference of item.proxies || []) {
            expect(available.has(reference), `${item.name} -> ${reference}`).to.equal(true);
        }
    }
}

describe('Clash-Full dynamic region script', function () {
    before(function () {
        $ = require('@/core/app').default;
        ({ ProxyUtils } = require('@/core/proxy-utils'));
        ({ produceArtifact } = require('@/utils/produce-artifact'));
        ({ main, prepareRegionTemplate } = new Function(
            'ProxyUtils', `${script}\nreturn { main, prepareRegionTemplate };`,
        )(ProxyUtils));
    });

    beforeEach(function () {
        original = Object.fromEntries(['read', 'write', 'info', 'error', 'warn', 'notify'].map((key) => [key, $[key]]));
        state = { [SUBS_KEY]: [], [COLLECTIONS_KEY]: [], [FILES_KEY]: [], [SETTINGS_KEY]: {} };
        $.read = (key) => state[key];
        $.write = (value, key) => { state[key] = value; };
        for (const key of ['info', 'error', 'warn', 'notify']) $[key] = () => {};
    });

    afterEach(function () {
        Object.assign($, original);
    });

    it('recognizes names, ISO codes and flags, and generates exact memberships with flags', function () {
        const output = main(fixture(['US-one', '日本 東京', '🇸🇬 relay', '香港-01', '台湾-01', 'UK London']));
        for (const [label, code, node] of [
            ['US美国', 'us', 'US-one'], ['JP日本', 'jp', '日本 東京'],
            ['SG新加坡', 'sg', '🇸🇬 relay'], ['HK香港', 'hk', '香港-01'],
            ['TW台湾', 'tw', '台湾-01'], ['GB英国', 'gb', 'UK London'],
        ]) {
            expect(group(output, label).proxies).to.deep.equal([`自动-${label}`, node]);
            expect(group(output, `自动-${label}`).proxies).to.deep.equal([node]);
            expect(group(output, label).icon).to.equal(`https://flagcdn.com/w80/${code}.png`);
            expect(group(output, `自动-${label}`).icon).to.equal(group(output, label).icon);
            expect(group(output, label)).not.to.have.property('filter');
            expect(group(output, `自动-${label}`)).not.to.have.property('include-all-proxies');
        }
        expectValidReferences(output);
    });

    it('keeps Fast/Balancer and non-country metadata in the unknown bucket', function () {
        const names = ['US-real', 'Fast-B1-1', 'Balancer-B1-1', '剩余流量：100GB', '套餐到期：2030-01-01'];
        const output = main(fixture(names));
        expect(group(output, '自动-US美国').proxies).to.deep.equal(['US-real']);
        expect(group(output, '自动-未识别地区').proxies).to.deep.equal(names.slice(1));
        expect(group(output, '未识别地区').icon).to.equal('https://example.com/world.png');
        expect(groupNames(output).some((name) => name.startsWith('EXP'))).to.equal(false);
        expect(output.proxies.map((item) => item.name)).to.deep.equal(names);
    });

    it('accepts lowercase country codes without changing original node names', function () {
        const output = main(fixture(['us-01', 'sG-02', 'jp03']));
        expect(group(output, '自动-US美国').proxies).to.deep.equal(['us-01']);
        expect(group(output, '自动-SG新加坡').proxies).to.deep.equal(['sG-02']);
        expect(group(output, '自动-JP日本').proxies).to.deep.equal(['jp03']);
    });

    it('does not interpret URLs and hostnames in announcements as country codes', function () {
        const names = ['官网:https://love.example.com', '官网2:site.example.COM', 'server.jp', 'SG-01 https://example.com'];
        const output = main(fixture(names));
        expect(group(output, '自动-未识别地区').proxies).to.deep.equal(names.slice(0, 3));
        expect(group(output, '自动-SG新加坡').proxies).to.deep.equal([names[3]]);
        expect(groupNames(output)).not.to.include('KM科摩罗');
        expect(groupNames(output)).not.to.include('JP日本');
    });

    it('orders existing regions first, new regions by code, and unknown last', function () {
        const output = main(fixture(['SG-1', 'Fast', 'TW-1', 'DE-1', 'HK-1', 'CA-1', 'JP-1', 'US-1']));
        expect(group(output, '国外AI').proxies).to.deep.equal([
            '全部节点', 'US美国', 'JP日本', 'HK香港', 'TW台湾', 'CA加拿大', 'DE德国', 'SG新加坡', '未识别地区', 'DIRECT',
        ]);
    });

    it('updates every business selector while preserving non-region entries', function () {
        const output = main(fixture(['SG-1', 'DE-1']));
        for (const name of selectorNames) {
            const expected = ['全部节点', 'DE德国', 'SG新加坡'];
            if (name === '默认节点') expected.push('国外AI');
            expected.push('DIRECT');
            expect(group(output, name).proxies).to.deep.equal(expected);
        }
        expect(group(output, '日本网站').proxies).to.deep.equal(['REJECT']);
        expectValidReferences(output);
    });

    it('preserves full health-check settings and the global groups', function () {
        const input = fixture();
        const output = main(input);
        const expected = { ...group(input, '自动-全部节点') };
        delete expected.name;
        delete expected['include-all-proxies'];
        expect(group(output, '自动-SG新加坡')).to.include(expected);
        expect(group(output, '全部节点')).to.deep.equal(group(input, '全部节点'));
        expect(group(output, '自动-全部节点')).to.deep.equal(group(input, '自动-全部节点'));
    });

    it('does not modify proxies, names, DNS, rules, or unrelated groups', function () {
        const input = fixture();
        const before = JSON.parse(JSON.stringify(input));
        const output = main(input);
        const withoutGroups = ({ 'proxy-groups': ignored, ...rest }) => rest;
        expect(input).to.deep.equal(before);
        expect(withoutGroups(output)).to.deep.equal(withoutGroups(before));
        for (const name of ['国内网站', '广告过滤']) expect(group(output, name)).to.deep.equal(group(before, name));
    });

    it('prepares a valid stored template without fixed countries or dangling references', function () {
        const template = prepareRegionTemplate(fixture());
        expect(groupNames(template)).not.to.include('JP日本');
        expect(group(template, '国外AI').proxies).to.deep.equal(['全部节点', 'DIRECT']);
        expect(group(template, '日本网站').proxies).to.deep.equal(['REJECT']);
        expectValidReferences(template);
        expect(main(template)).to.deep.equal(main(fixture()));
    });

    it('is idempotent and removes disappeared regions including the unknown group', function () {
        const first = main(fixture(['JP-1', 'SG-1', 'Fast']));
        expect(main(first)).to.deep.equal(first);
        const second = main({ ...first, proxies: [proxy('DE-new')] });
        expect(groupNames(second)).to.include('DE德国');
        for (const name of ['JP日本', '自动-JP日本', 'SG新加坡', '未识别地区']) expect(groupNames(second)).not.to.include(name);
        expect(group(second, '日本网站').proxies).to.deep.equal(['REJECT']);
        expectValidReferences(second);
        const third = main({ ...second, proxies: [] });
        expect(group(third, '国外AI').proxies).to.deep.equal(['全部节点', 'DIRECT']);
        expectValidReferences(third);
    });

    it('rejects ambiguous duplicate names and group-name collisions without renaming nodes', function () {
        expect(() => main(fixture(['US-1', 'US-1']))).to.throw('unique proxy and group names');
        expect(() => main(fixture(['SG新加坡']))).to.throw('conflicts with an existing name');
    });

    it('runs after collection injection and follows source disable/enable through the actual file pipeline', async function () {
        state[SUBS_KEY] = ['US-local', 'JP-local', 'SG-local'].map((name) => ({
            name, source: 'local', enabled: true, process: [],
            content: ProxyUtils.yaml.safeDump({ proxies: [proxy(name)] }),
        }));
        state[COLLECTIONS_KEY] = [{ name: 'regions', subscriptions: state[SUBS_KEY].map((item) => item.name), process: [] }];
        state[FILES_KEY] = [{
            name: 'dynamic-file', type: 'mihomoConfig', sourceType: 'local',
            content: ProxyUtils.yaml.safeDump(prepareRegionTemplate(fixture([]))),
            process: [
                { type: 'Add Proxies From Subscription Operator', args: { sourceType: 'collection', sourceName: 'regions', position: 'replace' } },
                { type: 'Script Operator', args: { mode: 'script', content: script } },
            ],
        }];
        const generate = async () => ProxyUtils.yaml.safeLoad(await produceArtifact({ type: 'file', name: 'dynamic-file', noFlow: true }));
        let output = await generate();
        expect(group(output, '自动-SG新加坡').proxies).to.deep.equal(['SG-local']);
        expect(group(output, '日本网站').proxies).to.deep.equal(['JP日本']);
        state[SUBS_KEY][2].enabled = false;
        state[SUBS_KEY][1].enabled = false;
        output = await generate();
        expect(output.proxies.map((item) => item.name)).to.deep.equal(['US-local']);
        expect(groupNames(output)).not.to.include('SG新加坡');
        expect(group(output, '日本网站').proxies).to.deep.equal(['REJECT']);
        expectValidReferences(output);
        state[SUBS_KEY][2].enabled = true;
        output = await generate();
        expect(group(output, '自动-SG新加坡').proxies).to.deep.equal(['SG-local']);
        state[SUBS_KEY].forEach((item) => { item.enabled = false; });
        let failure;
        try { await generate(); } catch (error) { failure = error; }
        expect(failure).to.have.property('code', 'NO_ACTIVE_SUBSCRIPTIONS');
    });
});
