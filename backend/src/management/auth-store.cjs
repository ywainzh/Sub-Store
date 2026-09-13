'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { readJson, atomicJson, isWithin, sha256 } = require('./contract.cjs');

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'sub_store_session';
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt, 64);
    return { algorithm: 'scrypt', salt, hash: hash.toString('hex') };
}

function secureEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateCredentials(credentials) {
    if (
        credentials?.formatVersion !== 1 || credentials.username !== 'admin' ||
        credentials.password?.algorithm !== 'scrypt' ||
        !/^[a-f0-9]{32}$/.test(credentials.password?.salt || '') ||
        !/^[a-f0-9]{128}$/.test(credentials.password?.hash || '') ||
        !/^[a-f0-9]{64}$/.test(credentials.apiTokenHash || '') ||
        !/^[a-f0-9]{32}$/.test(credentials.sessionEpoch || '')
    ) throw new Error('INVALID_AUTH_CREDENTIALS');
    return credentials;
}

async function newCredentials() {
    const password = randomSecret();
    const apiToken = randomSecret();
    return {
        credentials: {
            formatVersion: 1, username: 'admin', password: await hashPassword(password),
            apiTokenHash: sha256(apiToken), sessionEpoch: crypto.randomBytes(16).toString('hex'),
        },
        secrets: { username: 'admin', password, apiToken },
    };
}

function resolveAuthConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const enabled = /^(true|on|1)$/i.test(env.SUB_STORE_AUTH_ENABLED || '');
    if (production && !enabled) throw new Error('PRODUCTION_REQUIRES_AUTH');
    if (!enabled) return { enabled: false, production };
    const credentialsFile = env.SUB_STORE_AUTH_FILE;
    const sessionsFile = env.SUB_STORE_AUTH_SESSIONS_FILE;
    const dataDirectory = path.resolve(env.SUB_STORE_DATA_BASE_PATH || '.');
    if (
        !credentialsFile || !sessionsFile || !path.isAbsolute(credentialsFile) ||
        !path.isAbsolute(sessionsFile) || credentialsFile === sessionsFile ||
        isWithin(dataDirectory, credentialsFile) || isWithin(dataDirectory, sessionsFile)
    ) throw new Error('AUTH_FILES_MUST_BE_OUTSIDE_DATA_DIRECTORY');
    let origin;
    try {
        const url = new URL(env.SUB_STORE_PUBLIC_ORIGIN);
        if (url.origin !== env.SUB_STORE_PUBLIC_ORIGIN || (production && url.protocol !== 'https:') ||
            !['http:', 'https:'].includes(url.protocol)) throw new Error();
        origin = url.origin;
    } catch { throw new Error('INVALID_PUBLIC_ORIGIN'); }
    return { enabled, production, credentialsFile, sessionsFile, origin };
}

function createAuthStore(config, now = Date.now) {
    const loadCredentials = () => {
        const stat = fs.statSync(config.credentialsFile);
        if (process.platform !== 'win32' && (stat.mode & 0o007)) throw new Error('INSECURE_AUTH_FILE_PERMISSIONS');
        return validateCredentials(readJson(config.credentialsFile, { maxBytes: 4096 }));
    };
    loadCredentials(); // Fail closed at startup, including malformed or missing credentials.
    fs.accessSync(path.dirname(config.sessionsFile), fs.constants.R_OK | fs.constants.W_OK);
    function loadSessions() {
        const data = readJson(config.sessionsFile, { optional: true });
        if (data && (data.formatVersion !== 1 || !Array.isArray(data.sessions))) throw new Error('INVALID_SESSION_STORE');
        return (data?.sessions || []).filter(session => Number.isFinite(session.expiresAt) && session.expiresAt > now());
    }
    loadSessions();
    const saveSessions = sessions => atomicJson(config.sessionsFile, { formatVersion: 1, sessions });
    return {
        async verifyPassword(username, password) {
            const credentials = loadCredentials();
            const hash = await scrypt(password, credentials.password.salt, 64);
            return secureEqual(hash.toString('hex'), credentials.password.hash) && username === 'admin' &&
                loadCredentials().sessionEpoch === credentials.sessionEpoch;
        },
        verifyApiToken(token) {
            return typeof token === 'string' && token.length <= 256 &&
                secureEqual(sha256(token), loadCredentials().apiTokenHash);
        },
        createSession() {
            const token = randomSecret();
            const session = {
                hash: sha256(token), csrfToken: randomSecret(), createdAt: now(),
                expiresAt: now() + SESSION_TTL, epoch: loadCredentials().sessionEpoch,
            };
            const sessions = loadSessions().filter(item => item.epoch === session.epoch).slice(-31);
            saveSessions([...sessions, session]);
            return { token, ...session };
        },
        getSession(token) {
            if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
            const epoch = loadCredentials().sessionEpoch;
            return loadSessions().find(session => session.epoch === epoch && secureEqual(session.hash, sha256(token))) || null;
        },
        revokeSession(token) {
            saveSessions(loadSessions().filter(session => !secureEqual(session.hash, sha256(token || ''))));
        },
    };
}

module.exports = {
    SESSION_TTL, COOKIE_NAME, randomSecret, hashPassword, secureEqual,
    validateCredentials, newCredentials, resolveAuthConfig, createAuthStore,
};
