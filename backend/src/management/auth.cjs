'use strict';

const { resolveAuthConfig, createAuthStore, secureEqual, COOKIE_NAME, SESSION_TTL } = require('./auth-store.cjs');

const success = (res, data, status = 200) => res.status(status).json({ status: 'success', data });
const failure = (res, code, message, status) => res.status(status).json({ status: 'failed', error: { code, type: 'ManagementError', message } });

function readCookie(req) {
    const item = (req.headers.cookie || '').split(';').map(value => value.trim())
        .find(value => value.startsWith(`${COOKIE_NAME}=`));
    return item ? item.slice(COOKIE_NAME.length + 1) : '';
}

function removePrivateHeaders(req) {
    // Existing subscription processors receive _req.headers. Management credentials
    // must never be forwarded to scripts, subscriptions, exports or their logs.
    for (const key of ['authorization', 'cookie', 'x-csrf-token']) delete req.headers[key];
}

function createLoginLimiter(now = Date.now) {
    const entries = new Map();
    const windowMs = 15 * 60 * 1000;
    let globalEntry = { count: 0, until: now() + windowMs };
    return ip => {
        const timestamp = now();
        for (const [key, value] of entries) if (value.until <= timestamp) entries.delete(key);
        if (globalEntry.until <= timestamp) globalEntry = { count: 0, until: timestamp + windowMs };
        const entry = entries.get(ip) || { count: 0, until: timestamp + windowMs };
        if (entry.count >= 10 || globalEntry.count >= 100 || (!entries.has(ip) && entries.size >= 1024)) {
            return Math.max(1, Math.ceil((Math.min(entry.until, globalEntry.until) - timestamp) / 1000));
        }
        entry.count++;
        globalEntry.count++;
        entries.set(ip, entry);
        return 0;
    };
}

function registerAuth(app, { env = process.env, now = Date.now } = {}) {
    const config = resolveAuthConfig(env);
    const store = config.enabled ? createAuthStore(config, now) : null;
    const limitLogin = createLoginLimiter(now);
    const cookieOptions = {
        httpOnly: true, secure: config.production, sameSite: 'strict', path: '/',
        maxAge: SESSION_TTL,
    };
    const isSameOrigin = req => !req.headers.origin || req.headers.origin === config.origin;
    const isCrossSite = req => req.headers['sec-fetch-site'] === 'cross-site' || !isSameOrigin(req);
    const statusData = session => ({
        enabled: config.enabled, authenticated: !config.enabled || Boolean(session), username: session ? 'admin' : null,
        sessionExpiresAt: session?.expiresAt || null, csrfToken: session?.csrfToken || null,
        sessionLifetimeSeconds: SESSION_TTL / 1000,
    });

    app.use((req, res, next) => {
        if (!req.path.startsWith('/share/')) res.set('Cache-Control', 'no-store');
        next();
    });
    app.get('/api/auth/status', (req, res) => {
        if (config.enabled && isCrossSite(req)) return failure(res, 'ORIGIN_REJECTED', '请求来源不受信任', 403);
        try {
            const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '');
            if (store && bearer && store.verifyApiToken(bearer[1])) return success(res, { ...statusData({}), authMethod: 'api-token' });
            return success(res, statusData(store?.getSession(readCookie(req))));
        }
        catch { return failure(res, 'AUTH_UNAVAILABLE', '认证状态不可用，请联系服务器管理员', 503); }
    });
    app.post('/api/auth/login', async (req, res) => {
        if (!config.enabled) return failure(res, 'AUTH_DISABLED', '当前后端未启用管理认证', 409);
        if (isCrossSite(req) || !req.is('application/json')) return failure(res, 'ORIGIN_REJECTED', '请求来源不受信任', 403);
        const retryAfter = limitLogin(req.ip || req.socket.remoteAddress || 'unknown');
        if (retryAfter) {
            res.set('Retry-After', String(retryAfter));
            return failure(res, 'LOGIN_RATE_LIMITED', '登录尝试过多，请稍后重试', 429);
        }
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1024 || !password) {
            return failure(res, 'INVALID_CREDENTIALS', '账号或密码错误', 401);
        }
        try {
            if (!await store.verifyPassword(username, password)) return failure(res, 'INVALID_CREDENTIALS', '账号或密码错误', 401);
            store.revokeSession(readCookie(req));
            const session = store.createSession();
            res.cookie(COOKIE_NAME, session.token, cookieOptions);
            return success(res, statusData(session));
        } catch { return failure(res, 'AUTH_UNAVAILABLE', '认证状态不可用，请联系服务器管理员', 503); }
    });

    // This runs after backend-prefix normalization, before every existing management route.
    app.use((req, res, next) => {
        if (/^\/share\//.test(req.path) || /^\/api\/health\/?$/i.test(req.path)) {
            if (config.enabled) removePrivateHeaders(req);
            return next();
        }
        if (!config.enabled) return next();
        try {
            const authorization = req.headers.authorization;
            if (authorization) {
                const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
                if (!match || !store.verifyApiToken(match[1])) return failure(res, 'UNAUTHORIZED', '请先登录', 401);
                req.managementAuth = { type: 'api-token' };
                removePrivateHeaders(req);
                return next();
            }
            const token = readCookie(req);
            const session = store.getSession(token);
            if (!session) return failure(res, 'UNAUTHORIZED', '请先登录', 401);
            if (isCrossSite(req)) return failure(res, 'CSRF_REJECTED', '请求来源不受信任，请刷新页面', 403);
            // Protect legacy GET actions too. A same-origin download navigation cannot carry a custom header.
            const downloadNavigation = /^\/download(?:\/|$)/i.test(req.path) && req.method === 'GET' &&
                req.headers['sec-fetch-mode'] === 'navigate' && ['same-origin', 'none'].includes(req.headers['sec-fetch-site']);
            if (!downloadNavigation && !secureEqual(req.headers['x-csrf-token'], session.csrfToken)) {
                return failure(res, 'CSRF_REJECTED', '登录状态已变化，请刷新页面后重试', 403);
            }
            req.managementAuth = { type: 'session', token };
            removePrivateHeaders(req);
            return next();
        } catch { return failure(res, 'AUTH_UNAVAILABLE', '认证状态不可用，请联系服务器管理员', 503); }
    });
    app.post('/api/auth/logout', (req, res) => {
        try {
            if (store && req.managementAuth?.type === 'session') store.revokeSession(req.managementAuth.token);
            res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
            success(res, { authenticated: false });
        } catch { return failure(res, 'AUTH_UNAVAILABLE', '退出失败，请重试', 503); }
    });
    return config;
}

module.exports = { registerAuth, createLoginLimiter, success, failure };
