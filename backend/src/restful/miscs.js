import { Base64 } from 'js-base64';
import $ from '@/core/app';
import { ENV } from '@/vendor/open-api';
import { failed, success } from '@/restful/response';
import resourceCache from '@/utils/resource-cache';
import scriptResourceCache from '@/utils/script-resource-cache';
import headersResourceCache from '@/utils/headers-resource-cache';
import { RequestInvalidError } from '@/restful/errors';
import migrate from '@/utils/migration';
import env from '@/utils/env';
import {
    normalizeImportedAvailability,
    reconcileSubscriptionStatuses,
} from '@/utils/subscription-status';
import { formatDateTime } from '@/utils';
export default function register($app) {
    // utils
    $app.get('/api/utils/env', getEnv); // get runtime environment
    $app.get('/api/utils/refresh', refresh);

    // Storage management
    $app.route('/api/storage')
        .get((req, res) => {
            res.set('content-type', 'application/json')
                .set('access-control-expose-headers', 'content-disposition')
                .set(
                    'content-disposition',
                    `attachment; filename="${encodeURIComponent(
                        `sub-store_data_${formatDateTime(new Date())}.json`,
                    )}"`,
                )
                .send(
                    $.env.isNode
                        ? JSON.stringify($.cache)
                        : $.read('#sub-store'),
                );
        })
        .post((req, res) => {
            try {
                let { content } = req.body;
                try {
                    content = JSON.parse(Base64.decode(content));
                    if (!(Object.keys(content.settings).length >= 0)) {
                        throw new Error('备份文件应该至少包含 settings 字段');
                    }
                } catch (err) {
                    try {
                        content = JSON.parse(content);
                        if (!(Object.keys(content.settings).length >= 0)) {
                            throw new Error(
                                '备份文件应该至少包含 settings 字段',
                            );
                        }
                    } catch (err) {
                        $.error(
                            `备份文件校验失败, 无法还原\nReason: ${
                                err.message ?? err
                            }`,
                        );
                        throw new Error('备份文件校验失败, 无法还原');
                    }
                }
                normalizeImportedAvailability(content);
                $.write(JSON.stringify(content, null, `  `), '#sub-store');
                if ($.env.isNode) {
                    $.cache = content;
                    $.persistCache();
                }
                migrate();
                reconcileSubscriptionStatuses();
                success(res);
            } catch (e) {
                $.error(
                    `Failed to restore backup data.\nReason: ${e.message ?? e}`,
                );
                failed(
                    res,
                    new RequestInvalidError(
                        'INVALID_BACKUP_DATA',
                        'Invalid backup data, failed to restore!',
                        `Reason: ${e.message ?? e}`,
                    ),
                    400,
                );
            }
        });

    if (ENV().isNode) {
        $app.get('/', getEnv);
    } else {
        // Redirect sub.store to vercel webpage
        $app.get('/', async (req, res) => {
            // 302 redirect
            res.set('location', 'https://sub-store.vercel.app/')
                .status(302)
                .end();
        });
    }

    // handle preflight request for QX
    if (ENV().isQX) {
        $app.options('/', async (req, res) => {
            res.status(200).end();
        });
    }

    $app.all('/', (_, res) => {
        res.send('Hello from sub-store, made with ❤️ by Peng-YM');
    });
}

function getEnv(req, res) {
    env.feature = env.feature || {};
    if (req.query.share) {
        env.feature.share = true;
    }
    res.set('Content-Type', 'application/json;charset=UTF-8').send(
        JSON.stringify(
            {
                status: 'success',
                data: {
                    guide: '⚠️⚠️⚠️ 您当前看到的是后端的响应. 若想配合前端使用, 可访问官方前端 https://sub-store.vercel.app 后自行配置后端地址, 或一键配置后端 https://sub-store.vercel.app?api=https://a.com/xxx (假设 https://a.com 是你后端的域名, /xxx 是自定义路径). 需注意 HTTPS 前端无法请求非本地的 HTTP 后端(部分浏览器上也无法访问本地 HTTP 后端). 请配置反代或在局域网自建 HTTP 前端. 如果还有问题, 可查看此排查说明: https://telegram.me/zhetengsha/1068',
                    ...env,
                },
            },
            null,
            2,
        ),
    );
}

function refresh(_, res) {
    resourceCache.revokeAll();
    scriptResourceCache.revokeAll();
    headersResourceCache.revokeAll();
    success(res);
}
