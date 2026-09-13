import {
    NetworkError,
    InternalServerError,
    ResourceNotFoundError,
    RequestInvalidError,
} from './errors';
import {
    deleteByName,
    findByName,
    insertByPosition,
    updateByName,
} from '@/utils/database';
import { getCreateItemPosition } from '@/utils/create-item-position';
import {
    SUBS_KEY,
    COLLECTIONS_KEY,
    FILES_KEY,
} from '@/constants';
import {
    getFlowHeaders,
    parseFlowHeaders,
    getRmainingDays,
} from '@/utils/flow';
import { validateDeleteMode } from '@/utils/delete-mode';
import { success, failed } from './response';
import $ from '@/core/app';
import { formatDateTime } from '@/utils';
import { maskAgeSecretInUrl, normalizeAgePublicKeyConfig } from '@/utils/age';
import { normalizeEditorLanguageConfig } from '@/utils/editor-language';
import {
    checkSubscription,
    getAllSubscriptionStatuses,
    normalizeAvailabilityConfig,
    reconcileSubscriptionStatuses,
    availableSubscriptionUrls,
} from '@/utils/subscription-status';

if (!$.read(SUBS_KEY)) $.write({}, SUBS_KEY);

export default function register($app) {
    $app.get('/api/subs/status', (req, res) =>
        success(res, getAllSubscriptionStatuses()),
    );
    $app.route('/api/sub/:name/check').post(async (req, res) => {
        try {
            success(
                res,
                await checkSubscription(req.params.name, {
                    force: true,
                    manual: true,
                }),
            );
        } catch (error) {
            failed(res, error, error.code === 'RESOURCE_NOT_FOUND' ? 404 : 400);
        }
    });
    $app.get('/api/sub/flow/:name', getFlowInfo);

    $app.route('/api/sub/:name')
        .get(getSubscription)
        .patch(updateSubscription)
        .delete(deleteSubscription);

    $app.route('/api/subs')
        .get(getAllSubscriptions)
        .post(createSubscription)
        .put(replaceSubscriptions);
}

// subscriptions API
async function getFlowInfo(req, res) {
    let { name } = req.params;
    let { url } = req.query;
    if (url) {
        $.info(`指定远程订阅 URL: ${maskAgeSecretInUrl(url)}`);
    }
    const allSubs = $.read(SUBS_KEY);
    const sub = findByName(allSubs, name);
    if (!sub) {
        failed(
            res,
            new ResourceNotFoundError(
                'RESOURCE_NOT_FOUND',
                `Subscription ${name} does not exist!`,
            ),
            404,
        );
        return;
    }
    if (!url) await checkSubscription(sub);
    if (req.query.noFlow || sub.noFlow) {
        failed(
            res,
            new RequestInvalidError(
                'NO_FLOW_INFO',
                'N/A',
                `Subscription ${name}: noFlow`,
            ),
            400,
        );
        return;
    }
    if (
        sub.source === 'local' &&
        !['localFirst', 'remoteFirst'].includes(sub.mergeSources)
    ) {
        if (sub.subUserinfo) {
            let subUserInfo;
            if (/^https?:\/\//.test(sub.subUserinfo)) {
                try {
                    subUserInfo = await getFlowHeaders(
                        undefined,
                        undefined,
                        undefined,
                        sub.proxy,
                        sub.subUserinfo,
                    );
                } catch (e) {
                    $.error(
                        `订阅 ${name} 使用自定义流量链接 ${
                            sub.subUserinfo
                        } 获取流量信息时发生错误: ${JSON.stringify(e)}`,
                    );
                }
            } else {
                subUserInfo = sub.subUserinfo;
            }
            try {
                success(res, {
                    ...parseFlowHeaders(subUserInfo),
                });
            } catch (e) {
                $.error(
                    `Failed to parse flow info for local subscription ${name}: ${
                        e.message ?? e
                    }`,
                );
                failed(
                    res,
                    new RequestInvalidError(
                        'NO_FLOW_INFO',
                        'N/A',
                        `Failed to parse flow info`,
                    ),
                );
            }
        } else {
            failed(
                res,
                new RequestInvalidError(
                    'NO_FLOW_INFO',
                    'N/A',
                    `Local subscription ${name} has no flow information!`,
                ),
            );
        }
        return;
    }
    try {
        url =
            `${url || availableSubscriptionUrls(sub)[0] || sub.url}`
                .split(/[\r\n]+/)
                .map((i) => i.trim())
                .filter((i) => i.length)?.[0] || '';

        let $arguments = {};
        const rawArgs = url.split('#');
        url = url.split('#')[0];
        if (rawArgs.length > 1) {
            try {
                // 支持 `#${encodeURIComponent(JSON.stringify({arg1: "1"}))}`
                $arguments = JSON.parse(decodeURIComponent(rawArgs[1]));
            } catch (e) {
                for (const pair of rawArgs[1].split('&')) {
                    const key = pair.split('=')[0];
                    const value = pair.split('=')[1];
                    // 部分兼容之前的逻辑 const value = pair.split('=')[1] || true;
                    $arguments[key] =
                        value == null || value === ''
                            ? true
                            : decodeURIComponent(value);
                }
            }
        }
        if ($arguments.noFlow || !/^https?/.test(url)) {
            failed(
                res,
                new RequestInvalidError(
                    'NO_FLOW_INFO',
                    'N/A',
                    `Subscription ${name}: noFlow`,
                ),
            );
            return;
        }
        const flowHeaders = await getFlowHeaders(
            $arguments?.insecure ? `${url}#insecure` : url,
            $arguments.flowUserAgent,
            undefined,
            sub.proxy,
            $arguments.flowUrl,
            $arguments.flowHeaders,
        );
        if (!flowHeaders && !sub.subUserinfo) {
            failed(
                res,
                new InternalServerError(
                    'NO_FLOW_INFO',
                    'No flow info',
                    `Failed to fetch flow headers`,
                ),
            );
            return;
        }
        try {
            const remainingDays = getRmainingDays({
                resetDay: $arguments.resetDay,
                startDate: $arguments.startDate,
                cycleDays: $arguments.cycleDays,
            });
            let subUserInfo;
            if (/^https?:\/\//.test(sub.subUserinfo)) {
                try {
                    subUserInfo = await getFlowHeaders(
                        undefined,
                        undefined,
                        undefined,
                        sub.proxy,
                        sub.subUserinfo,
                    );
                } catch (e) {
                    $.error(
                        `订阅 ${name} 使用自定义流量链接 ${
                            sub.subUserinfo
                        } 获取流量信息时发生错误: ${JSON.stringify(e)}`,
                    );
                }
            } else {
                subUserInfo = sub.subUserinfo;
            }
            const result = {
                ...parseFlowHeaders(
                    [subUserInfo, flowHeaders].filter((i) => i).join('; '),
                ),
            };
            if (remainingDays != null) {
                result.remainingDays = remainingDays;
            }
            success(res, result);
        } catch (e) {
            $.error(
                `Failed to parse flow info for local subscription ${name}: ${
                    e.message ?? e
                }`,
            );
            failed(
                res,
                new RequestInvalidError(
                    'NO_FLOW_INFO',
                    'N/A',
                    `Failed to parse flow info`,
                ),
            );
        }
    } catch (err) {
        failed(
            res,
            new NetworkError(
                `URL_NOT_ACCESSIBLE`,
                `The URL for subscription ${name} is inaccessible.`,
            ),
        );
    }
}

function createSubscription(req, res) {
    try {
        const sub = createSubscriptionItem(req.body);
        success(res, sub, 201);
    } catch (error) {
        failed(
            res,
            error,
            error.code === 'INVALID_AVAILABILITY_CONFIG' ? 400 : 500,
        );
    }
}

function getSubscription(req, res) {
    let { name } = req.params;
    let { raw } = req.query;
    const allSubs = $.read(SUBS_KEY);
    const sub = findByName(allSubs, name);
    if (sub) {
        delete sub.subscriptions;
        if (raw) {
            res.set('content-type', 'application/json')
                .set('access-control-expose-headers', 'content-disposition')
                .set(
                    'content-disposition',
                    `attachment; filename="${encodeURIComponent(
                        `sub-store_subscription_${name}_${formatDateTime(
                            new Date(),
                        )}.json`,
                    )}"`,
                )
                .send(JSON.stringify(sub));
        } else {
            success(res, sub);
        }
    } else {
        failed(
            res,
            new ResourceNotFoundError(
                `SUBSCRIPTION_NOT_FOUND`,
                `Subscription ${name} does not exist`,
                404,
            ),
        );
    }
}

function updateSubscription(req, res) {
    let { name } = req.params;
    let sub = req.body;
    delete sub.subscriptions;
    const allSubs = $.read(SUBS_KEY);
    const oldSub = findByName(allSubs, name);
    if (oldSub) {
        if (!sub.name) sub.name = oldSub.name;
        const newSub = {
            ...oldSub,
            ...sub,
        };
        try {
            normalizeAvailabilityConfig(newSub);
        } catch (error) {
            return failed(res, error, 400);
        }
        normalizeAgePublicKeyConfig(newSub);
        normalizeEditorLanguageConfig(newSub);
        $.info(`正在更新订阅： ${name}`);
        // allow users to update the subscription name
        if (name !== sub.name) {
            // update all collections refer to this name
            const allCols = $.read(COLLECTIONS_KEY) || [];
            for (const collection of allCols) {
                const idx = collection.subscriptions.indexOf(name);
                if (idx !== -1) {
                    collection.subscriptions[idx] = sub.name;
                }
            }

            // update all files referring this subscription
            const allFiles = $.read(FILES_KEY) || [];
            for (const file of allFiles) {
                if (
                    file.sourceType === 'subscription' &&
                    file.sourceName == name
                ) {
                    file.sourceName = sub.name;
                }
            }

            $.write(allCols, COLLECTIONS_KEY);
            $.write(allFiles, FILES_KEY);
        }
        updateByName(allSubs, name, newSub);
        $.write(allSubs, SUBS_KEY);
        reconcileSubscriptionStatuses(oldSub, newSub);
        success(res, newSub);
    } else {
        failed(
            res,
            new ResourceNotFoundError(
                'RESOURCE_NOT_FOUND',
                `Subscription ${name} does not exist!`,
            ),
            404,
        );
    }
}

function deleteSubscription(req, res) {
    try {
        const { name } = req.params;
        $.info(`删除订阅：${name}...`);
        validateDeleteMode(req.query?.mode);
        deleteSubscriptionItem(name);
        success(res);
    } catch (error) {
        failed(res, error, error.code === 'INVALID_DELETE_MODE' ? 400 : 500);
    }
}

function getAllSubscriptions(req, res) {
    const allSubs = $.read(SUBS_KEY);
    success(res, allSubs);
}

function replaceSubscriptions(req, res) {
    try {
        const allSubs = req.body;
        allSubs.forEach((sub) => {
            normalizeAvailabilityConfig(sub);
            normalizeAgePublicKeyConfig(sub);
            normalizeEditorLanguageConfig(sub);
        });
        $.write(allSubs, SUBS_KEY);
        reconcileSubscriptionStatuses();
        success(res);
    } catch (error) {
        failed(
            res,
            error,
            error.code === 'INVALID_AVAILABILITY_CONFIG' ? 400 : 500,
        );
    }
}

function createSubscriptionItem(rawSub) {
    const sub = {
        ...rawSub,
    };
    normalizeAvailabilityConfig(sub);
    normalizeAgePublicKeyConfig(sub);
    normalizeEditorLanguageConfig(sub);
    delete sub.subscriptions;
    $.info(`正在创建订阅： ${sub.name}`);
    if (/\//.test(sub.name)) {
        throw new RequestInvalidError(
            'INVALID_NAME',
            `Subscription ${sub.name} is invalid`,
        );
    }
    const allSubs = $.read(SUBS_KEY);
    if (findByName(allSubs, sub.name)) {
        throw new RequestInvalidError(
            'DUPLICATE_KEY',
            `Subscription ${sub.name} already exists.`,
        );
    }
    insertByPosition(allSubs, sub, getCreateItemPosition());
    $.write(allSubs, SUBS_KEY);
    return sub;
}

function deleteSubscriptionItem(name) {
    const allSubs = $.read(SUBS_KEY);
    const sub = findByName(allSubs, name);
    if (!sub) {
        throw new ResourceNotFoundError(
            'RESOURCE_NOT_FOUND',
            `Subscription ${name} does not exist!`,
        );
    }
    deleteByName(allSubs, name);
    $.write(allSubs, SUBS_KEY);
    reconcileSubscriptionStatuses();

    const allCols = $.read(COLLECTIONS_KEY) || [];
    for (const collection of allCols) {
        collection.subscriptions = collection.subscriptions.filter(
            (subscriptionName) => subscriptionName !== name,
        );
    }
    $.write(allCols, COLLECTIONS_KEY);
    return sub;
}

export { createSubscriptionItem, deleteSubscriptionItem };
