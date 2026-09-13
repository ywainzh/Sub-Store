import $ from '@/core/app';
import { SUBS_KEY, COLLECTIONS_KEY, SETTINGS_KEY } from '@/constants';
import { getFlowHeaders, parseFlowObservation } from '@/utils/flow';
import { hex_md5 } from '@/vendor/md5';
import { RequestInvalidError } from '@/restful/errors';

export const SUBS_STATUS_KEY = '#sub-store-subscription-status';
export const CHECK_INTERVAL = 30 * 60 * 1000;
const MERGE_MODES = ['localFirst', 'remoteFirst'];
const flights = new Map();
const queue = [];
let running = 0;
let timer;

export class SubscriptionUnavailableError extends Error {
    constructor(code, reason) {
        const messages = {
            manual: '订阅已手动停用',
            expired: '订阅已到期',
            exhausted: '订阅流量已用尽',
            empty: '暂无可用订阅',
            changed: '订阅状态已变化，请重新获取',
        };
        super(messages[reason] || messages.empty);
        this.code = code;
        this.type = 'SubscriptionUnavailableError';
        this.statusCode = 409;
        this.details = reason;
    }
}

export const isSubscriptionUnavailable = (error) =>
    error?.type === 'SubscriptionUnavailableError';

export function isRemoteSubscription(sub) {
    return sub.source !== 'local' || MERGE_MODES.includes(sub.mergeSources);
}

export function normalizeAvailabilityConfig(item, collection = false) {
    for (const key of collection ? ['enabled'] : ['enabled', 'autoManage']) {
        if (item[key] != null && typeof item[key] !== 'boolean') {
            throw new RequestInvalidError(
                'INVALID_AVAILABILITY_CONFIG',
                `${key} must be a boolean`,
            );
        }
    }
    item.enabled = item.enabled !== false;
    if (!collection)
        item.autoManage =
            item.autoManage !== false && isRemoteSubscription(item);
    else delete item.autoManage;
    // Runtime decisions never come from a configuration import or PATCH.
    for (const key of [
        'availability',
        'active',
        'reason',
        'checkedAt',
        'checkState',
        'sources',
        'availableSources',
        'sourceCount',
        'partial',
        'firstAvailable',
    ])
        delete item[key];
    return item;
}

export function normalizeImportedAvailability(data) {
    for (const [key, collection] of [
        [SUBS_KEY, false],
        [COLLECTIONS_KEY, true],
    ]) {
        for (const item of Object.values(data[key] || {})) {
            const hadEnabled = Object.prototype.hasOwnProperty.call(
                item,
                'enabled',
            );
            const hadAutoManage = Object.prototype.hasOwnProperty.call(
                item,
                'autoManage',
            );
            normalizeAvailabilityConfig(item, collection);
            // Older exports stay optional; their defaults are computed when read.
            if (!hadEnabled) delete item.enabled;
            if (!hadAutoManage) delete item.autoManage;
        }
    }
}

export function splitSubscriptionUrls(value) {
    return [
        ...new Set(
            String(value || '')
                .split(/[\r\n]+/)
                .map((i) => i.trim())
                .filter(Boolean),
        ),
    ];
}

export function parseSourceArguments(raw) {
    const [url, fragment] = raw.split('#');
    let args = {};
    if (fragment) {
        try {
            args = JSON.parse(decodeURIComponent(fragment));
        } catch {
            for (const pair of fragment.split('&')) {
                const index = pair.indexOf('=');
                const key = index < 0 ? pair : pair.slice(0, index);
                const value = index < 0 ? '' : pair.slice(index + 1);
                try {
                    args[key] = value ? decodeURIComponent(value) : true;
                } catch {
                    /* Invalid metadata is unknown. */
                }
            }
        }
    }
    return { url, args: args && typeof args === 'object' ? args : {} };
}

function sourcesOf(sub) {
    return isRemoteSubscription(sub) ? splitSubscriptionUrls(sub.url) : [];
}

function hasLocalSource(sub) {
    return (
        !isRemoteSubscription(sub) ||
        (MERGE_MODES.includes(sub.mergeSources) && Boolean(sub.content?.trim()))
    );
}

function fingerprint(sub) {
    const settings = $.read(SETTINGS_KEY) || {};
    return hex_md5(
        JSON.stringify([
            sub.source,
            sub.url,
            sub.mergeSources,
            sub.content,
            sub.subUserinfo,
            sub.noFlow,
            sub.proxy,
            settings.defaultProxy,
            settings.defaultFlowUserAgent,
        ]),
    );
}

function readStore() {
    try {
        const value = $.read(SUBS_STATUS_KEY);
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && !Array.isArray(parsed) && typeof parsed === 'object'
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function savedSubscription(name) {
    const subs = $.read(SUBS_KEY);
    return Array.isArray(subs)
        ? subs.find((sub) => sub.name === name)
        : undefined;
}

function recordOf(sub) {
    const record = readStore()[hex_md5(sub.name || '')];
    return record?.fingerprint === fingerprint(sub) ? record.sources || {} : {};
}

function sourceReason(record, now = Date.now()) {
    if (record?.expires > 0 && record.expires * 1000 <= now) return 'expired';
    if (
        record?.quota &&
        record.quota.upload + record.quota.download >= record.quota.total
    )
        return 'exhausted';
    return null;
}

function flowOf(record) {
    if (!record?.quota && record?.expires == null) return undefined;
    return {
        ...(record.quota
            ? {
                  total: record.quota.total,
                  usage: {
                      upload: record.quota.upload,
                      download: record.quota.download,
                  },
              }
            : {}),
        expires: record.expires || undefined,
    };
}

export function getSubscriptionStatus(sub) {
    const records = recordOf(sub);
    const autoManage = isRemoteSubscription(sub) && sub.autoManage !== false;
    const enabled = sub.enabled !== false;
    const sources = sourcesOf(sub).map((url, index) => {
        const record = records[hex_md5(url)];
        const reason = enabled
            ? autoManage
                ? sourceReason(record)
                : null
            : 'manual';
        return {
            index,
            active: !reason,
            reason,
            checkedAt: record?.checkedAt || null,
            checkState: record?.checkState || 'unchecked',
            flow: flowOf(record),
        };
    });
    const localCount = hasLocalSource(sub) ? 1 : 0;
    const availableSources = enabled
        ? sources.filter((source) => source.active).length + localCount
        : 0;
    const sourceCount = sources.length + localCount;
    const active = enabled && (availableSources > 0 || sourceCount === 0);
    return {
        name: sub.name,
        enabled,
        autoManage,
        active,
        reason: enabled
            ? active
                ? null
                : sources.find((source) => source.reason)?.reason || 'empty'
            : 'manual',
        partial: active && availableSources < sourceCount,
        availableSources,
        sourceCount,
        sources,
        checkedAt:
            Math.max(0, ...sources.map((source) => source.checkedAt || 0)) ||
            null,
    };
}

export function collectionSubscriptions(collection) {
    const all = $.read(SUBS_KEY) || [];
    const names = [...new Set(collection.subscriptions || [])];
    if (collection.subscriptionTags?.length) {
        for (const sub of all) {
            if (
                !names.includes(sub.name) &&
                sub.tag?.some((tag) =>
                    collection.subscriptionTags.includes(tag),
                )
            )
                names.push(sub.name);
        }
    }
    return names
        .map((name) => all.find((sub) => sub.name === name))
        .filter(Boolean);
}

export function getCollectionStatus(collection) {
    const subs = collectionSubscriptions(collection);
    const available = subs.filter((sub) => getSubscriptionStatus(sub).active);
    const enabled = collection.enabled !== false;
    return {
        name: collection.name,
        enabled,
        active: enabled && available.length > 0,
        reason: !enabled ? 'manual' : available.length ? null : 'empty',
        availableSources: enabled ? available.length : 0,
        sourceCount: subs.length,
        partial:
            enabled && available.length > 0 && available.length < subs.length,
        firstAvailable: enabled ? available[0]?.name || null : null,
        checkedAt:
            Math.max(
                0,
                ...subs.map((sub) => getSubscriptionStatus(sub).checkedAt || 0),
            ) || null,
    };
}

export function getAllSubscriptionStatuses() {
    return {
        subscriptions: ($.read(SUBS_KEY) || []).map(getSubscriptionStatus),
        collections: ($.read(COLLECTIONS_KEY) || []).map(getCollectionStatus),
    };
}

function pump() {
    while (running < 2 && queue.length) {
        const { task, resolve, reject } = queue.shift();
        running++;
        Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
                running--;
                pump();
            });
    }
}

function queued(task) {
    return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
    });
}

async function observeSource(sub, rawUrl) {
    const { url, args } = parseSourceArguments(rawUrl);
    if (sub.noFlow || args.noFlow || !/^https?:\/\//i.test(url))
        return { checkState: 'unsupported' };
    const options = {
        fresh: true,
        allowPartial: true,
        strictStatus: true,
        quiet: true,
    };
    try {
        const headers = await getFlowHeaders(
            args.insecure ? `${url}#insecure` : url,
            args.flowUserAgent,
            undefined,
            sub.proxy,
            args.flowUrl,
            args.flowHeaders,
            options,
        );
        let custom = sub.subUserinfo;
        if (/^https?:\/\//i.test(custom)) {
            custom = await getFlowHeaders(
                undefined,
                undefined,
                undefined,
                sub.proxy,
                custom,
                undefined,
                options,
            );
        }
        const observation = parseFlowObservation(
            [custom, headers].filter(Boolean).join('; '),
        );
        return {
            ...observation,
            checkState: Object.keys(observation).length
                ? 'observed'
                : 'missing',
        };
    } catch {
        return { checkState: 'error' };
    }
}

export async function checkSubscription(
    subOrName,
    { force = false, manual = false } = {},
) {
    const sub =
        typeof subOrName === 'string'
            ? savedSubscription(subOrName)
            : subOrName;
    if (!sub)
        throw new RequestInvalidError(
            'RESOURCE_NOT_FOUND',
            'Subscription does not exist',
        );
    if (
        !isRemoteSubscription(sub) ||
        (!manual && (sub.enabled === false || sub.autoManage === false))
    )
        return getSubscriptionStatus(sub);
    const signature = fingerprint(sub);
    const original = savedSubscription(sub.name);
    const records = recordOf(sub);
    await Promise.all(
        sourcesOf(sub).map(async (rawUrl) => {
            const id = hex_md5(rawUrl);
            if (!force && records[id]?.checkedAt > Date.now() - CHECK_INTERVAL)
                return;
            // The same source/configuration shares its request even across subscriptions.
            const settings = $.read(SETTINGS_KEY) || {};
            const flightKey = hex_md5(
                JSON.stringify([
                    rawUrl,
                    sub.subUserinfo,
                    sub.noFlow,
                    sub.proxy,
                    settings.defaultProxy,
                    settings.defaultFlowUserAgent,
                    settings.defaultTimeout,
                ]),
            );
            let flight = flights.get(flightKey);
            if (!flight) {
                flight = queued(() => observeSource(sub, rawUrl));
                flights.set(flightKey, flight);
                flight.finally(() => {
                    if (flights.get(flightKey) === flight)
                        flights.delete(flightKey);
                });
            }
            const observation = await flight;
            const current = savedSubscription(sub.name);
            // A PATCH, delete/recreate or import replaces the object. Old requests must not write back.
            if (
                !original ||
                current !== original ||
                fingerprint(current) !== signature
            )
                return;
            const store = readStore();
            const key = hex_md5(sub.name);
            const previous =
                store[key]?.fingerprint === signature
                    ? store[key].sources || {}
                    : {};
            store[key] = {
                fingerprint: signature,
                sources: {
                    ...previous,
                    [id]: {
                        ...previous[id],
                        ...observation,
                        checkedAt: Date.now(),
                    },
                },
            };
            $.write(JSON.stringify(store), SUBS_STATUS_KEY);
        }),
    );
    return getSubscriptionStatus(savedSubscription(sub.name) || sub);
}

export function reconcileSubscriptionStatuses(oldSub, newSub) {
    const store = readStore();
    if (oldSub && newSub && oldSub.name !== newSub.name) {
        const record = store[hex_md5(oldSub.name)];
        if (record?.fingerprint === fingerprint(newSub))
            store[hex_md5(newSub.name)] = record;
        delete store[hex_md5(oldSub.name)];
    }
    const subs = $.read(SUBS_KEY) || [];
    const valid = new Map(
        subs.map((sub) => [hex_md5(sub.name), fingerprint(sub)]),
    );
    for (const key of Object.keys(store))
        if (valid.get(key) !== store[key]?.fingerprint) delete store[key];
    $.write(JSON.stringify(store), SUBS_STATUS_KEY);
}

export function availableSubscriptionUrls(sub, value = sub.url) {
    if (sub.enabled === false) return [];
    const state = getSubscriptionStatus(sub);
    const urls = sourcesOf(sub);
    const known = new Map(
        urls.map((url, index) => [url, state.sources[index].active]),
    );
    const blocked = new Set(
        urls
            .filter((url, index) => !state.sources[index].active)
            .map((url) => url.split('#')[0]),
    );
    return splitSubscriptionUrls(value).filter((url) =>
        known.has(url) ? known.get(url) : !blocked.has(url.split('#')[0]),
    );
}

export function assertSubscriptionAvailable(sub) {
    const current = savedSubscription(sub.name) || sub;
    const status = getSubscriptionStatus(current);
    if (!status.active)
        throw new SubscriptionUnavailableError(
            'SUBSCRIPTION_DISABLED',
            status.reason,
        );
    if (fingerprint(current) !== fingerprint(sub))
        throw new SubscriptionUnavailableError(
            'SUBSCRIPTION_CHANGED',
            'changed',
        );
    return status;
}

export function assertCollectionAvailable(collection) {
    const current =
        ($.read(COLLECTIONS_KEY) || []).find(
            (item) => item.name === collection.name,
        ) || collection;
    const status = getCollectionStatus(current);
    if (!status.active)
        throw new SubscriptionUnavailableError(
            status.reason === 'manual'
                ? 'COLLECTION_DISABLED'
                : 'NO_ACTIVE_SUBSCRIPTIONS',
            status.reason,
        );
    return current;
}

export async function prepareSubscription(sub) {
    await checkSubscription(sub);
    return assertSubscriptionAvailable(sub);
}

export async function prepareCollection(collection) {
    if (collection.enabled === false)
        throw new SubscriptionUnavailableError('COLLECTION_DISABLED', 'manual');
    const subs = collectionSubscriptions(collection);
    await Promise.all(subs.map((sub) => checkSubscription(sub)));
    const available = subs.filter(
        (sub) =>
            getSubscriptionStatus(savedSubscription(sub.name) || sub).active,
    );
    if (!available.length)
        throw new SubscriptionUnavailableError(
            'NO_ACTIVE_SUBSCRIPTIONS',
            'empty',
        );
    return available;
}

export async function checkAllSubscriptions() {
    const subs = ($.read(SUBS_KEY) || []).filter(
        (sub) =>
            sub.enabled !== false &&
            sub.autoManage !== false &&
            isRemoteSubscription(sub),
    );
    await Promise.allSettled(subs.map((sub) => checkSubscription(sub)));
}

export function startSubscriptionChecks() {
    if (!$.env.isNode || timer) return;
    reconcileSubscriptionStatuses();
    const run = async () => {
        await checkAllSubscriptions();
        if (!timer) return;
        const due = ($.read(SUBS_KEY) || [])
            .filter(
                (sub) =>
                    sub.enabled !== false &&
                    sub.autoManage !== false &&
                    isRemoteSubscription(sub),
            )
            .flatMap((sub) =>
                getSubscriptionStatus(sub).sources.map(
                    (source) =>
                        (source.checkedAt || Date.now()) + CHECK_INTERVAL,
                ),
            );
        const next = Math.max(
            1000,
            Math.min(CHECK_INTERVAL, ...due.map((time) => time - Date.now())),
        );
        timer = setTimeout(run, next);
        timer.unref?.();
    };
    timer = setTimeout(run, 0);
    timer.unref?.();
}

export function stopSubscriptionChecks() {
    clearTimeout(timer);
    timer = undefined;
}
