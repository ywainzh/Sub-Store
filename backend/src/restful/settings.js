import { SETTINGS_KEY } from '@/constants';
import { success, failed } from './response';
import { InternalServerError } from '@/restful/errors';
import $ from '@/core/app';
import { clearLogSettingsCache } from '@/utils/debug-logs';
import {
    BACKEND_REQUEST_CONCURRENCY_SETTING,
    BACKEND_REQUEST_CONCURRENCY_WAIT_TIME_SETTING,
} from '@/utils/request-concurrency';
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export default function register($app) {
    const settings = $.read(SETTINGS_KEY);
    if (!settings) $.write({}, SETTINGS_KEY);
    $app.route('/api/settings').get(getSettings).patch(updateSettings);
}

async function getSettings(req, res) {
    try {
        let settings = $.read(SETTINGS_KEY);
        if (!settings) {
            settings = {};
            $.write(settings, SETTINGS_KEY);
        }

        success(res, settings);
    } catch (e) {
        $.error(`Failed to get settings: ${e.message ?? e}`);
        failed(
            res,
            new InternalServerError(
                `FAILED_TO_GET_SETTINGS`,
                `Failed to get settings`,
                `Reason: ${e.message ?? e}`,
            ),
        );
    }
}

async function updateSettings(req, res) {
    try {
        const settings = $.read(SETTINGS_KEY) || {};
        const newSettings = {
            ...settings,
            ...req.body,
        };
        if (isPlainObject(req.body?.appearanceSetting)) {
            newSettings.appearanceSetting = {
                ...(isPlainObject(settings?.appearanceSetting)
                    ? settings.appearanceSetting
                    : {}),
                ...req.body.appearanceSetting,
            };
        }
        [
            'defaultTimeout',
            'cacheThreshold',
            'resourceCacheTtl',
            'headersCacheTtl',
            'scriptCacheTtl',
        ].map((key) => {
            let value = Number(newSettings[key]);
            if (!isFinite(value) || value <= 0) {
                delete newSettings[key];
            }
        });
        if ('logsMaxCount' in newSettings) {
            const rawLogsMaxCount = newSettings.logsMaxCount;
            const value = Number(rawLogsMaxCount);
            if (
                rawLogsMaxCount === null ||
                rawLogsMaxCount === undefined ||
                rawLogsMaxCount === '' ||
                !isFinite(value) ||
                value < 0
            ) {
                delete newSettings.logsMaxCount;
            }
        }
        if (BACKEND_REQUEST_CONCURRENCY_SETTING in newSettings) {
            const rawConcurrency =
                newSettings[BACKEND_REQUEST_CONCURRENCY_SETTING];
            const value = Number(rawConcurrency);
            if (
                rawConcurrency === null ||
                rawConcurrency === undefined ||
                rawConcurrency === '' ||
                !Number.isInteger(value) ||
                value < 1
            ) {
                delete newSettings[BACKEND_REQUEST_CONCURRENCY_SETTING];
            }
        }
        if (BACKEND_REQUEST_CONCURRENCY_WAIT_TIME_SETTING in newSettings) {
            const rawWaitTime =
                newSettings[BACKEND_REQUEST_CONCURRENCY_WAIT_TIME_SETTING];
            const value = Number(rawWaitTime);
            if (
                rawWaitTime === null ||
                rawWaitTime === undefined ||
                rawWaitTime === '' ||
                !Number.isInteger(value) ||
                value < 0
            ) {
                delete newSettings[
                    BACKEND_REQUEST_CONCURRENCY_WAIT_TIME_SETTING
                ];
            }
        }
        $.write(newSettings, SETTINGS_KEY);
        clearLogSettingsCache();
        success(res, newSettings);
    } catch (e) {
        $.error(`Failed to update settings: ${e.message ?? e}`);
        failed(
            res,
            new InternalServerError(
                `FAILED_TO_UPDATE_SETTINGS`,
                `Failed to update settings`,
                `Reason: ${e.message ?? e}`,
            ),
        );
    }
}
