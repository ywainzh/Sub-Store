// Inline Script Operator for Clash-Full, placed AFTER node injection.
// Sub-Store supplies ProxyUtils and invokes main(config). No network requests.
const REGION_ORDER = ['US', 'JP', 'HK', 'TW'];
const UNKNOWN_REGION = '未识别地区';
const REGION_SELECTORS = new Set([
    '默认节点',
    '国外AI',
    'YouTube',
    'Pixiv',
    '游戏专用',
    '下载软件',
    '其他外网',
]);
const REGION_DISPLAY_NAMES = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

function normalizeRegionCode(code) {
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) return null;
    return code === 'UK' ? 'GB' : code;
}

function regionLabel(code) {
    const shortNames = { HK: '香港', MO: '澳门' };
    const name = shortNames[code] || REGION_DISPLAY_NAMES.of(code);
    return name && name !== code ? `${code}${name}` : code;
}

function isManagedRegionGroup(name) {
    if (typeof name !== 'string') return false;
    const label = name.replace(/^自动-/, '');
    if (label === UNKNOWN_REGION) return true;
    const code = normalizeRegionCode(label.slice(0, 2));
    return code !== null && label === regionLabel(code);
}

// Also used when preparing the stored template. Its groups remain valid even
// before the Script Operator runs; no fixed country groups or dangling links.
function prepareRegionTemplate(config) {
    if (!Array.isArray(config['proxy-groups'])) {
        throw new Error('Dynamic regions require a proxy-groups template');
    }
    const removed = new Set(
        config['proxy-groups']
            .filter((group) => isManagedRegionGroup(group.name))
            .map((group) => group.name),
    );
    const groups = config['proxy-groups']
        .filter((group) => !removed.has(group.name))
        .map((group) => {
            if (group.name === '日本网站') {
                return { ...group, proxies: ['REJECT'] };
            }
            if (!Array.isArray(group.proxies)) return { ...group };
            const proxies = group.proxies.filter((name) => !removed.has(name));
            return {
                ...group,
                proxies: proxies.length || group.proxies.length === 0
                    ? proxies
                    : ['REJECT'],
            };
        });
    return { ...config, 'proxy-groups': groups };
}

function main(config) {
    if (!Array.isArray(config.proxies)) {
        throw new Error('Dynamic regions must run after node injection');
    }
    const template = prepareRegionTemplate(config);
    const groups = template['proxy-groups'];
    const allIndex = groups.findIndex((group) => group.name === '全部节点');
    const autoTemplate = groups.find((group) => group.name === '自动-全部节点');
    if (allIndex === -1 || autoTemplate?.type !== 'url-test') {
        throw new Error('Dynamic regions require the existing all-node groups');
    }

    const buckets = new Map();
    const occupiedNames = new Set(groups.map((group) => group.name));
    for (const proxy of config.proxies) {
        if (typeof proxy.name !== 'string' || !proxy.name || occupiedNames.has(proxy.name)) {
            throw new Error('Dynamic regions require unique proxy and group names');
        }
        occupiedNames.add(proxy.name);
        // A website's .com/.jp suffix is not the node's country. In particular,
        // uppercasing .com would match the ISO alpha-3 code for Comoros.
        const geographicName = proxy.name
            .replace(/\bhttps?:\/\/\S+/gi, ' ')
            .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]\S*)?/gi, ' ');
        // EXP/BAND and other non-country markers belong to the unknown bucket.
        const code = normalizeRegionCode(ProxyUtils.getISO(geographicName))
            || normalizeRegionCode(ProxyUtils.getISO(geographicName.toUpperCase()));
        if (!buckets.has(code)) buckets.set(code, []);
        buckets.get(code).push(proxy.name);
    }
    const codes = [...buckets.keys()].sort((left, right) => {
        if (left === null) return 1;
        if (right === null) return -1;
        const leftRank = REGION_ORDER.indexOf(left);
        const rightRank = REGION_ORDER.indexOf(right);
        return (leftRank < 0 ? REGION_ORDER.length : leftRank)
            - (rightRank < 0 ? REGION_ORDER.length : rightRank)
            || left.localeCompare(right, 'en');
    });

    const autoOptions = { ...autoTemplate };
    for (const key of [
        'name', 'icon', 'proxies', 'use', 'filter', 'exclude-filter',
        'exclude-type', 'include-all', 'include-all-proxies', 'include-all-providers',
    ]) delete autoOptions[key];
    const regionGroups = [];
    const regionNames = [];
    for (const code of codes) {
        const name = code === null ? UNKNOWN_REGION : regionLabel(code);
        const automatic = `自动-${name}`;
        for (const groupName of [automatic, name]) {
            if (occupiedNames.has(groupName)) {
                throw new Error('A generated region group conflicts with an existing name');
            }
            occupiedNames.add(groupName);
        }
        const icon = code === null
            ? groups[allIndex].icon
            : `https://flagcdn.com/w80/${code.toLowerCase()}.png`;
        const proxies = buckets.get(code);
        regionNames.push(name);
        regionGroups.push(
            { ...autoOptions, name: automatic, type: 'url-test', proxies: [...proxies], icon },
            { name, type: 'select', proxies: [automatic, ...proxies], icon },
        );
    }

    const rewritten = groups.map((group) => {
        if (group.name === '日本网站') {
            return { ...group, proxies: [buckets.has('JP') ? regionLabel('JP') : 'REJECT'] };
        }
        if (!REGION_SELECTORS.has(group.name)) return group;
        const proxies = group.proxies || [];
        const anchor = proxies.indexOf('全部节点');
        if (anchor === -1) {
            throw new Error('A regional selector is missing its all-node fallback');
        }
        return {
            ...group,
            proxies: [...proxies.slice(0, anchor + 1), ...regionNames, ...proxies.slice(anchor + 1)],
        };
    });
    rewritten.splice(allIndex + 1, 0, ...regionGroups);
    return { ...template, 'proxy-groups': rewritten };
}
