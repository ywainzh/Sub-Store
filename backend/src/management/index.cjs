'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { registerAuth, success, failure } = require('./auth.cjs');
const { createReleaseCatalog } = require('./releases.cjs');
const { readJson, assertTag, validateManifest, canReadData, compareTags, DATA_SCHEMA, TERMINAL_PHASES } = require('./contract.cjs');

function loadManifest(env = process.env) {
    if (!env.SUB_STORE_RELEASE_MANIFEST) return null;
    const manifest = readJson(env.SUB_STORE_RELEASE_MANIFEST, { maxBytes: 64 * 1024 });
    return validateManifest(manifest, manifest.tag);
}

function registerManagement(app, { env = process.env, catalog = createReleaseCatalog(), manifest = loadManifest(env) } = {}) {
    const auth = registerAuth(app, { env });
    const enabled = env.SUB_STORE_ONLINE_MANAGEMENT === 'true' && auth.enabled && Boolean(manifest);
    const directory = env.SUB_STORE_DEPLOY_DIRECTORY || '/var/lib/sub-store-deploy';
    const releasesDirectory = env.SUB_STORE_RELEASES_DIRECTORY || '/opt/sub-store/releases';
    const inboxFile = path.join(directory, 'inbox', 'request.json');
    const stateFile = path.join(directory, 'state', 'installation.json');
    const currentSchema = () => {
        const data = readJson(path.join(env.SUB_STORE_DATA_BASE_PATH || '.', 'sub-store.json'), { optional: true, maxBytes: 64 * 1024 * 1024 });
        return data?.schemaVersion || DATA_SCHEMA;
    };
    const state = () => readJson(stateFile, { optional: true }) || {};
    const readTask = id => readJson(path.join(directory, 'state', `${id}.json`), { optional: true, maxBytes: 64 * 1024 });
    const pendingTask = () => {
        const request = readJson(inboxFile, { optional: true, maxBytes: 4096 });
        return request ? { id: request.id, tag: request.tag, phase: 'queued', restoreData: request.restoreData } : null;
    };
    const activeTask = () => {
        const id = state().activeDeployment;
        const task = id ? readTask(id) : null;
        return task && !TERMINAL_PHASES.has(task.phase) ? task : pendingTask();
    };
    function localPrevious(installation) {
        try {
            const tag = assertTag(installation.previous);
            const previousManifest = validateManifest(readJson(path.join(releasesDirectory, tag, 'release-manifest.json')), tag);
            return { tag, manifest: previousManifest, notes: '', local: true, publishedAt: null };
        } catch { return null; }
    }
    function publicVersion(release, installation, schema) {
        const canRestoreData = installation.snapshot?.tag === release.tag && canReadData(release.manifest, installation.snapshot.dataSchema);
        return {
            tag: release.tag, notes: release.notes, publishedAt: release.publishedAt,
            local: release.local, previous: installation.previous === release.tag,
            compatible: canReadData(release.manifest, schema), canRestoreData,
            versions: release.manifest.versions,
        };
    }
    const handle = handler => async (req, res) => {
        try { await handler(req, res); }
        catch (error) {
            const code = /^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'MANAGEMENT_UNAVAILABLE';
            const badRequest = /^(INVALID_|INCOMPATIBLE_|NOT_A_|INCOMPLETE_)/.test(code);
            failure(res, code, badRequest ? '目标版本或请求不符合要求' : '版本管理暂时不可用，请稍后重试', badRequest ? 400 : 503);
        }
    };

    app.get('/api/health', (req, res) => success(res, {
        ready: true, projectVersion: manifest?.tag || 'development', commit: manifest?.commit || null,
        authEnabled: auth.enabled, managementVersion: manifest?.compatibility.management || null,
    }));
    app.get('/api/system/versions', handle(async (req, res) => {
        if (!enabled) return success(res, { enabled: false, current: manifest?.tag || null, versions: [], previous: null });
        const page = req.query.page === undefined ? 1 : Number(req.query.page);
        if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('INVALID_RELEASE_PAGE');
        const installation = state();
        const schema = currentSchema();
        const previous = localPrevious(installation);
        const versions = new Map();
        let nextPage = null;
        let remoteError = null;
        try {
            const result = await catalog.list(page);
            for (const version of result.versions) versions.set(version.tag, version);
            nextPage = result.nextPage;
        } catch { remoteError = '暂时无法连接 GitHub，仍可回退到本地上一版。'; }
        if (previous) versions.set(previous.tag, { ...versions.get(previous.tag), ...previous, notes: versions.get(previous.tag)?.notes || '' });
        const list = [...versions.values()].map(version => publicVersion(version, installation, schema))
            .filter(version => version.compatible || version.canRestoreData)
            .sort((a, b) => compareTags(b.tag, a.tag));
        const latest = list.find(version => version.compatible && compareTags(version.tag, manifest.tag) > 0)?.tag || null;
        success(res, {
            enabled, current: manifest.tag, previous: previous?.tag || null, latest,
            versions: list, snapshot: installation.snapshot || null, page, nextPage, remoteError,
            activeDeployment: activeTask(),
        });
    }));
    app.post('/api/system/deployments', handle(async (req, res) => {
        if (!enabled) return failure(res, 'DEPLOYMENT_DISABLED', '此服务器尚未安装在线部署助手', 409);
        const { tag, restoreData = false } = req.body || {};
        assertTag(tag);
        if (typeof restoreData !== 'boolean' || Object.keys(req.body).some(key => !['tag', 'restoreData'].includes(key))) throw new Error('INVALID_DEPLOYMENT_REQUEST');
        const active = activeTask();
        if (active) return res.status(409).json({ status: 'failed', error: { code: 'DEPLOYMENT_BUSY', type: 'ManagementError', message: '已有部署正在执行', deploymentId: active.id } });
        if (tag === manifest.tag) return failure(res, 'ALREADY_CURRENT_VERSION', '已经是该版本', 409);
        const installation = state();
        const local = localPrevious(installation);
        const target = local?.tag === tag ? local : await catalog.get(tag);
        const schema = restoreData ? installation.snapshot?.dataSchema : currentSchema();
        if ((restoreData && installation.snapshot?.tag !== tag) || !canReadData(target.manifest, schema)) throw new Error('INCOMPATIBLE_DATA_SCHEMA');
        if (activeTask()) return failure(res, 'DEPLOYMENT_BUSY', '已有部署正在执行', 409);
        const request = { id: crypto.randomUUID(), tag, restoreData };
        // Publish a complete request with an atomic no-overwrite link. systemd.path
        // can never observe a half-written JSON document.
        const stagedRequest = path.join(directory, 'inbox', `${request.id}.tmp`);
        const descriptor = fs.openSync(stagedRequest, 'wx', 0o640);
        try { fs.writeFileSync(descriptor, JSON.stringify(request)); fs.fsyncSync(descriptor); }
        finally { fs.closeSync(descriptor); }
        try { fs.linkSync(stagedRequest, inboxFile); }
        catch (error) {
            if (error.code === 'EEXIST') return failure(res, 'DEPLOYMENT_BUSY', '已有部署正在执行', 409);
            throw error;
        } finally { fs.unlinkSync(stagedRequest); }
        success(res, { ...request, phase: 'queued' }, 202);
    }));
    app.get('/api/system/deployments/:id', handle(async (req, res) => {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(req.params.id)) throw new Error('INVALID_DEPLOYMENT_ID');
        const task = readTask(req.params.id) || (pendingTask()?.id === req.params.id ? pendingTask() : null);
        if (!task) return failure(res, 'DEPLOYMENT_NOT_FOUND', '未找到部署记录', 404);
        success(res, task);
    }));
    return { auth, manifest };
}

module.exports = { registerManagement, loadManifest };
