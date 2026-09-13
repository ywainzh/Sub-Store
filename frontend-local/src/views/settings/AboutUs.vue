<template>
  <div class="page-wrapper">
    <div class="about-wrapper">
      <div class="block-content">
        <nut-cell-group :title="$t('aboutUsPage.projectInfo.title')">
          <nut-cell class="cell-item" title="项目版本" :desc="currentVersion">
            <template #link><a :href="`${project}/releases`" target="_blank" rel="noopener noreferrer">更新记录</a></template>
          </nut-cell>
          <nut-cell class="cell-item" :title="$t('aboutUsPage.projectInfo.fe')" :desc="`v${frontendVersion}`" />
          <nut-cell class="cell-item" :title="$t('aboutUsPage.projectInfo.be')" :desc="env.version ? `v${env.version}` : '—'" />
          <nut-cell class="cell-item" title="项目与文档">
            <template #link>
              <div class="link-group">
                <a :href="project" target="_blank" rel="noopener noreferrer">项目</a>
                <a :href="`${project}/blob/release/deploy/README.md`" target="_blank" rel="noopener noreferrer">使用文档</a>
              </div>
            </template>
          </nut-cell>
        </nut-cell-group>

        <nut-cell-group v-if="env.backend === 'Node' || versions?.enabled || deployment" title="版本管理">
          <nut-cell class="cell-item" title="版本更新" :desc="currentVersion">
            <template #link><ActionButton type="primary" size="small" :loading="checking === 'update'" :disabled="busy || !!checking" @click="openUpdate">检查更新</ActionButton></template>
          </nut-cell>
          <nut-cell class="cell-item" title="版本回退" :desc="versions?.previous ? `本地上一版 ${versions.previous}` : '选择兼容的历史版本'">
            <template #link><ActionButton size="small" :loading="checking === 'rollback'" :disabled="busy || !!checking" @click="openRollback">选择版本</ActionButton></template>
          </nut-cell>
          <div v-if="message || versions?.remoteError" class="status-card" role="status">{{ message || versions?.remoteError }}</div>
          <div v-if="deployment" class="status-card deployment-status" aria-live="polite">
            <div class="deployment-title">{{ deployment.tag }} · {{ phaseLabel }}</div>
            <p v-if="reconnecting">正在等待服务器恢复连接，部署任务会继续执行。</p>
            <p v-else-if="deployment.phase === 'failed'">{{ deployment.restored ? '未能完成部署，已恢复操作前的版本和数据。' : '部署未完成，当前版本保持不变。' }}</p>
            <p v-else-if="deployment.phase === 'recovery-required'">自动恢复尚未完成，请通过 SSH 检查服务器。</p>
            <p v-else-if="busy">可以离开或刷新页面，回来后会继续查询进度。</p>
            <button v-if="reconnecting" type="button" class="text-button" @click="pollDeployment">重新查询</button>
          </div>
        </nut-cell-group>

        <nut-cell-group title="开源说明">
          <nut-cell class="cell-item" title="原作者与贡献者">
            <template #link><a href="https://github.com/sub-store-org" target="_blank" rel="noopener noreferrer">Sub-Store 团队</a></template>
          </nut-cell>
          <nut-cell class="cell-item" title="许可证">
            <template #link><div class="link-group"><a :href="`${project}/blob/release/LICENSE`" target="_blank" rel="noopener noreferrer">后端 AGPL-3.0</a><a :href="`${project}/blob/release/frontend-local/LICENSE`" target="_blank" rel="noopener noreferrer">前端 GPL-3.0</a></div></template>
          </nut-cell>
        </nut-cell-group>
        <ActionButton v-if="authState.enabled && authState.authenticated" class="logout-button" :loading="loggingOut" :disabled="loggingOut || busy" @click="signOut">退出登录</ActionButton>
      </div>
    </div>

    <nut-dialog v-model:visible="dialogVisible" :title="dialogMode === 'update' ? '版本更新' : '版本回退'" pop-class="auto-dialog version-dialog" :no-footer="true" :close-on-click-overlay="false">
      <div class="version-dialog-content">
        <p class="current-line">当前版本 {{ currentVersion }}</p>
        <label v-if="dialogMode === 'rollback'" for="release-select">目标版本</label>
        <select v-if="dialogMode === 'rollback'" id="release-select" v-model="selectedTag" :disabled="busy" @change="restoreSnapshot = false">
          <option value="" disabled>请选择版本</option>
          <option v-for="item in rollbackVersions" :key="item.tag" :value="item.tag">{{ item.tag }}{{ item.local ? ' · 本地上一版' : '' }}{{ !item.compatible ? ' · 需要恢复快照' : '' }}</option>
        </select>
        <p v-else class="target-line">更新到 {{ selectedTag }}</p>
        <button v-if="dialogMode === 'rollback' && versions?.nextPage" class="text-button" type="button" :disabled="!!checking || busy" @click="loadOlder">{{ checking ? '正在加载…' : '加载更早版本' }}</button>
        <p v-if="!selectedVersion?.notes" class="version-notes">{{ selectedVersion?.local ? '此版本已保留在服务器，可直接回退。' : '此版本未提供更新说明。' }}</p>
        <pre v-else class="version-notes">{{ selectedVersion.notes }}</pre>
        <p class="data-hint">默认保留最新订阅数据。</p>
        <label v-if="dialogMode === 'rollback' && selectedVersion?.canRestoreData" class="snapshot-option">
          <input v-model="restoreSnapshot" type="checkbox" :disabled="busy" />
          <span>同时恢复此版本的数据快照<span v-if="versions?.snapshot?.createdAt">（{{ formatDate(versions.snapshot.createdAt) }}）</span></span>
        </label>
        <p v-if="restoreSnapshot" class="data-hint">快照之后的订阅修改将被替换，登录凭据保持不变。</p>
        <p v-if="dialogError" class="dialog-error" role="alert">{{ dialogError }}</p>
        <div class="dialog-actions">
          <ActionButton :disabled="submitting" @click="dialogVisible = false">取消</ActionButton>
          <ActionButton type="primary" :loading="submitting" :disabled="busy || !selectedTag || (!selectedVersion?.compatible && !restoreSnapshot)" @click="submitDeployment">{{ dialogMode === 'update' ? '确认更新' : '确认回退' }}</ActionButton>
        </div>
      </div>
    </nut-dialog>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useGlobalStore } from '@/store/global';
import { authState, logout, managementRequest, ManagementError } from '@/utils/managementAuth';
import { resetPwaCacheAndReload } from '@/utils/pwa';
import ActionButton from '@/components/ActionButton.vue';

interface ReleaseVersion { tag: string; notes: string; local: boolean; compatible: boolean; canRestoreData: boolean; }
interface Deployment { id: string; tag: string; phase: string; current?: string; restored?: boolean; }
interface VersionList {
  enabled: boolean; current: string | null; previous: string | null; latest: string | null;
  versions: ReleaseVersion[]; nextPage: number | null; remoteError: string | null;
  snapshot?: { tag: string; createdAt: string }; activeDeployment?: Deployment;
}
const project = 'https://github.com/ywainzh/Sub-Store';
const frontendVersion = import.meta.env.PACKAGE_VERSION;
const { env } = storeToRefs(useGlobalStore());
const versions = ref<VersionList | null>(null);
const deployment = ref<Deployment | null>(null);
const checking = ref('');
const submitting = ref(false);
const loggingOut = ref(false);
const reconnecting = ref(false);
const message = ref('');
const dialogError = ref('');
const dialogVisible = ref(false);
const dialogMode = ref<'update' | 'rollback'>('update');
const selectedTag = ref('');
const restoreSnapshot = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let polling = false;
const phaseNames: Record<string, string> = {
  queued: '等待开始', resolving: '检查目标版本', downloading: '下载发布包', verifying: '校验发布包',
  preparing: '准备新版本', stopping: '停止服务', snapshotting: '保存数据快照', switching: '切换版本',
  starting: '启动服务', checking: '检查服务状态', cleaning: '清理临时文件', 'rolling-back': '正在恢复原版本',
  succeeded: '部署完成', failed: '部署失败', 'recovery-required': '需要检查恢复状态',
};
const phaseLabel = computed(() => phaseNames[deployment.value?.phase || ''] || '查询状态');
const busy = computed(() => submitting.value || Boolean(deployment.value && !['succeeded', 'failed'].includes(deployment.value.phase)));
const currentVersion = computed(() => versions.value?.current || env.value.projectVersion || import.meta.env.VITE_PROJECT_VERSION || '开发版本');
const selectedVersion = computed(() => versions.value?.versions.find(item => item.tag === selectedTag.value));
const isOlder = (tag: string, current: string) => {
  const a = tag.slice(1).split('.').map(Number);
  const b = current.slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
};
const rollbackVersions = computed(() => (versions.value?.versions || []).filter(item => versions.value?.current && isOlder(item.tag, versions.value.current)));
const formatDate = (date: string) => new Date(date).toLocaleString();

function rememberDeployment(task: Deployment) {
  deployment.value = task;
  sessionStorage.setItem('sub-store-deployment', JSON.stringify({ id: task.id, tag: task.tag }));
}
async function loadVersions(page = 1) {
  const result = await managementRequest<VersionList>(`/api/system/versions?page=${page}`);
  if (page > 1 && versions.value) {
    const combined = new Map(versions.value.versions.map(item => [item.tag, item]));
    result.versions.forEach(item => combined.set(item.tag, item));
    result.versions = [...combined.values()];
  }
  versions.value = result;
  if (result.activeDeployment) { rememberDeployment(result.activeDeployment); void pollDeployment(); }
  return result;
}
async function openUpdate() {
  checking.value = 'update'; message.value = ''; dialogError.value = '';
  try {
    const result = await loadVersions();
    if (!result.enabled) { message.value = '此服务器尚未安装在线部署助手。'; return; }
    if (busy.value) return;
    if (!result.latest) { message.value = result.remoteError || '当前已是最新兼容版本。'; return; }
    dialogMode.value = 'update'; selectedTag.value = result.latest; restoreSnapshot.value = false; dialogVisible.value = true;
  } catch (error) { message.value = error instanceof Error ? error.message : '检查更新失败'; }
  finally { checking.value = ''; }
}
async function openRollback() {
  checking.value = 'rollback'; message.value = ''; dialogError.value = '';
  try {
    const result = await loadVersions();
    if (!result.enabled) { message.value = '此服务器尚未安装在线部署助手。'; return; }
    if (busy.value) return;
    if (!rollbackVersions.value.length && !result.nextPage) { message.value = result.remoteError || '暂时没有可回退的兼容历史版本。'; return; }
    dialogMode.value = 'rollback'; selectedTag.value = rollbackVersions.value[0]?.tag || ''; restoreSnapshot.value = false; dialogVisible.value = true;
  } catch (error) { message.value = error instanceof Error ? error.message : '读取历史版本失败'; }
  finally { checking.value = ''; }
}
async function loadOlder() {
  if (!versions.value?.nextPage) return;
  checking.value = 'older';
  try { await loadVersions(versions.value.nextPage); }
  catch { dialogError.value = '暂时无法读取更早版本，请重试。'; }
  finally { checking.value = ''; }
}
async function submitDeployment() {
  if (busy.value || !selectedTag.value) return;
  submitting.value = true; dialogError.value = '';
  try {
    const task = await managementRequest<Deployment>('/api/system/deployments', {
      method: 'POST', body: JSON.stringify({ tag: selectedTag.value, restoreData: restoreSnapshot.value }),
    });
    rememberDeployment(task); dialogVisible.value = false; void pollDeployment();
  } catch (error) {
    if (error instanceof ManagementError && error.deploymentId) {
      rememberDeployment({ id: error.deploymentId, tag: selectedTag.value, phase: 'queued' });
      dialogVisible.value = false; void pollDeployment();
    } else {
      dialogError.value = error instanceof Error ? error.message : '未收到服务器确认，正在查询部署状态。';
      try { await loadVersions(); if (deployment.value) dialogVisible.value = false; } catch { /* Leave the error visible. */ }
    }
  } finally { submitting.value = false; }
}
async function pollDeployment() {
  if (!deployment.value || polling || disposed) return;
  clearTimeout(timer); polling = true;
  try {
    const task = await managementRequest<Deployment>(`/api/system/deployments/${deployment.value.id}`);
    deployment.value = task; reconnecting.value = false;
    if (task.phase === 'succeeded') {
      const health = await managementRequest<{ projectVersion: string; ready: boolean }>('/api/health');
      if (!health.ready || health.projectVersion !== task.current) throw new Error('等待目标版本就绪');
      sessionStorage.removeItem('sub-store-deployment');
      sessionStorage.setItem('sub-store-deployment-notice', `已切换到 ${task.current}`);
      localStorage.removeItem('envCache');
      await resetPwaCacheAndReload({ reloadDelay: 300 });
      return;
    }
    if (task.phase === 'failed') { sessionStorage.removeItem('sub-store-deployment'); await loadVersions(); return; }
  } catch { reconnecting.value = true; }
  finally { polling = false; }
  if (!disposed) timer = setTimeout(pollDeployment, 2000);
}
async function signOut() {
  loggingOut.value = true;
  try { await logout(); }
  catch { message.value = '退出失败，请重试。'; }
  finally { loggingOut.value = false; }
}
onMounted(async () => {
  message.value = sessionStorage.getItem('sub-store-deployment-notice') || '';
  sessionStorage.removeItem('sub-store-deployment-notice');
  try {
    const saved = JSON.parse(sessionStorage.getItem('sub-store-deployment') || 'null');
    if (saved?.id) { deployment.value = { ...saved, phase: 'queued' }; void pollDeployment(); }
  } catch { sessionStorage.removeItem('sub-store-deployment'); }
  try { await loadVersions(); }
  catch { if (!deployment.value) message.value = '版本信息暂时不可用，可以稍后重试。'; }
});
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); });
</script>

<style lang="scss" scoped>
@import '@/assets/styles/custom_variables.scss';
.page-wrapper { min-height: 100%; padding-bottom: 28px; }
.about-wrapper { margin-top: 16px; }
.block-content { margin: 0 var(--safe-area-side); display: flex; flex-direction: column; gap: 12px; }
.cell-item { box-shadow: none; background: var(--card-color); border-radius: var(--item-card-radios); font-weight: bold; align-items: center; gap: 12px; }
.cell-item :deep(.nut-cell__value) { font-weight: normal; font-size: 12px; }
a, .text-button { color: var(--primary-color); font-weight: normal; }
.link-group { display: flex; gap: 16px; flex-wrap: wrap; }
.status-card { background: var(--card-color); padding: 16px 20px; border-radius: var(--item-card-radios); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.deployment-title { font-weight: 600; margin-bottom: 6px; }
.deployment-status p { opacity: .75; }
.logout-button { align-self: center; min-width: 140px; margin-top: 8px; }
.version-dialog-content { text-align: left; font-size: 14px; }
.current-line, .data-hint { opacity: .7; margin-bottom: 12px; }
.target-line { font-weight: 600; margin: 12px 0; }
select { display: block; width: 100%; min-height: 44px; margin: 8px 0 12px; border: 1px solid var(--nut-border-color, #9995); border-radius: 8px; padding: 8px; color: inherit; background: var(--card-color); font: inherit; }
.version-notes { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 25vh; overflow: auto; font: inherit; font-size: 13px; line-height: 1.7; margin: 14px 0; padding: 12px; background: var(--card-color); border-radius: 8px; }
.snapshot-option { display: flex; align-items: flex-start; gap: 10px; min-height: 44px; margin-bottom: 10px; }
.snapshot-option input { width: 18px; height: 18px; flex-shrink: 0; margin-top: 2px; accent-color: var(--primary-color); }
.dialog-actions { display: flex; gap: 12px; margin-top: 18px; }
.dialog-actions > * { flex: 1; }
.dialog-error { color: var(--nut-danger-color, #e95b63); font-size: 13px; margin: 10px 0; }
.text-button { border: 0; background: none; padding: 8px 0; min-height: 44px; cursor: pointer; }
.text-button:disabled { opacity: .5; cursor: default; }
@media (max-width: 380px) { .cell-item { gap: 8px; padding: 14px 12px; } .link-group { gap: 10px; } }
</style>
