<template>
  <div class="my-page-wrapper">
    <div class="profile-block">
      <div class="profile-toolbar">
        <LanguageSwitcherButton />
      </div>
      <div class="info">
        <div class="avatar-wrapper">
          <nut-avatar class="avatar-fallback" size="72" bg-color="var(--card-color)" :icon="avatar" />
          <div class="name">
            <p class="title">{{ $t('myPage.storage.manual.label') }}</p>
            <p class="des">{{ $t('myPage.storage.manual.desc') }}</p>
          </div>
        </div>
        <div class="actions">
          <input type="file" ref="fileInput" @change="fileChange" style="display: none">
          <nut-button
            class="upload-btn"
            plain
            type="primary"
            :disabled="restoreIsLoading"
            size="small"
            :loading="restoreIsLoading"
            @click="upload()"
          >
            <font-awesome-icon
              icon="fa-solid fa-cloud-arrow-up"
              v-if="!restoreIsLoading"
            />
            {{ $t(`myPage.storage.manual.restore`) }}
          </nut-button>
          <nut-button
            class="download-btn"
            type="primary"
            size="small"
            :disabled="backupIsLoading"
            :loading="backupIsLoading"
            @click="downloadBackup"
          >
            <font-awesome-icon
              v-if="!backupIsLoading"
              icon="fa-solid fa-cloud-arrow-down"
            />
            {{ $t(`myPage.storage.manual.backup`) }}
          </nut-button>
        </div>
      </div>
      <div class="config-card">
        <div class="title-wrapper"  @click="isRequestConfigEditing ? exitEditMode('request') : toggleEditMode('request')">
          <h1>{{ $t(`myPage.requestConfig`) }}</h1>
          <div class="config-btn-wrapper">
            <nut-button
              v-if="isRequestConfigEditing"
              class="cancel-btn"
              plain
              type="info"
              size="mini"
              @click.stop="exitEditMode('request')"
              :disabled="isEditLoading"
            >
              <font-awesome-icon icon="fa-solid fa-ban" />
              {{ $t(`myPage.btn.cancel`) }}
            </nut-button>
            <nut-button
             v-if="isRequestConfigEditing"
              class="save-btn"
              type="primary"
              size="mini"
              @click.stop="toggleEditMode('request')"
              :loading="isEditLoading"
            >
              <font-awesome-icon
                v-if="!isRequestConfigEditing"
                icon="fa-solid fa-pen-to-square"
              />
              <font-awesome-icon
                v-else-if="!isEditLoading && isRequestConfigEditing"
                icon="fa-solid fa-floppy-disk"
              />
              {{ !isRequestConfigEditing ? $t(`myPage.btn.edit`) : $t(`myPage.btn.save`) }}
            </nut-button>
             <nut-icon v-else class="right-icon" name="right"></nut-icon>
          </div>
        </div>
        <div class="config-input-wrapper" v-if="isRequestConfigEditing">
          <nut-input
            class="input"
            v-model="proxyInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.defaultProxy`)"
            type="text"
            input-align="left"
            :left-icon="iconProxy"
            right-icon="tips"
            @click-right-icon="proxyTips"
          />
          <nut-input
            class="input"
            v-model="uaInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.defaultUserAgent`)"
            type="text"
            input-align="left"
            :left-icon="iconUA"
            right-icon="tips"
            @click-right-icon="uaTips"
          />
          <nut-input
            class="input"
            v-model="flowUaInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.defaultFlowUserAgent`)"
            type="text"
            input-align="left"
            :left-icon="iconUA"
            right-icon="tips"
            @click-right-icon="flowUaTips"
          />
          <nut-input
            class="input"
            v-model="timeoutInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.defaultTimeout`)"
            type="number"
            input-align="left"
            :left-icon="iconTimeout"
            right-icon="tips"
            @click-right-icon="timeoutTips"
          />
          <nut-input
            class="input"
            v-model="backendRequestConcurrencyInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.backendRequestConcurrency`)"
            type="number"
            input-align="left"
            :left-icon="iconConcurrency"
            right-icon="tips"
            @click-right-icon="backendRequestConcurrencyTips"
          />
          <nut-input
            class="input"
            v-model="backendRequestConcurrencyWaitTimeInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.backendRequestConcurrencyWaitTime`)"
            type="number"
            input-align="left"
            :left-icon="iconTimeout"
            right-icon="tips"
            @click-right-icon="backendRequestConcurrencyWaitTimeTips"
          />
          <nut-input
            class="input"
            v-model="githubProxyInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.githubProxy`)"
            type="text"
            input-align="left"
            :left-icon="icongithubProxy"
            right-icon="tips"
            @click-right-icon="githubProxyTips"
          />
          <nut-input
            class="input"
            v-model="githubProxyRegexInput"
            :disabled="!isRequestConfigEditing"
            :placeholder="$t(`myPage.placeholder.githubProxyRegex`)"
            type="text"
            input-align="left"
            :left-icon="icongithubProxy"
            right-icon="tips"
            @click-right-icon="githubProxyRegexTips"
          />
        </div>
      </div>
      <div class="config-card">
        <div class="title-wrapper" @click="isCacheConfigEditing ? exitEditMode('cache') : toggleEditMode('cache')">
          <h1>{{ $t(`myPage.cacheConfig`) }}</h1>
          <div class="config-btn-wrapper">
            <nut-button
              v-if="isCacheConfigEditing"
              class="cancel-btn"
              plain
              type="info"
              size="mini"
              @click.stop="exitEditMode('cache')"
              :disabled="isEditLoading"
            >
              <font-awesome-icon icon="fa-solid fa-ban" />
              {{ $t(`myPage.btn.cancel`) }}
            </nut-button>
            <nut-button
              v-if="isCacheConfigEditing"
              class="save-btn"
              type="primary"
              size="mini"
              @click.stop="toggleEditMode('cache')"
              :loading="isEditLoading"
            >
              <font-awesome-icon
                v-if="!isCacheConfigEditing"
                icon="fa-solid fa-pen-to-square"
              />
              <font-awesome-icon
                v-else-if="!isEditLoading && isCacheConfigEditing"
                icon="fa-solid fa-floppy-disk"
              />
              {{ !isCacheConfigEditing ? $t(`myPage.btn.edit`) : $t(`myPage.btn.save`) }}
            </nut-button>
            <nut-icon v-else class="right-icon" name="right"></nut-icon>
          </div>
        </div>
        <div class="config-input-wrapper" v-if="isCacheConfigEditing">

          <nut-input
            class="input"
            v-model="cacheThresholdInput"
            :disabled="!isCacheConfigEditing"
            :placeholder="$t(`myPage.placeholder.cacheThreshold`)"
            type="number"
            input-align="left"
            :left-icon="iconMax"
            right-icon="tips"
            @click-right-icon="cacheThresholdTips"
          />
          <nut-input
            class="input"
            v-model="resourceCacheTtlInput"
            :disabled="!isCacheConfigEditing"
            :placeholder="$t(`myPage.placeholder.resourceCacheTtl`)"
            type="number"
            input-align="left"
            :left-icon="iconResourceCacheTtl"
            right-icon="tips"
            @click-right-icon="resourceCacheTtlTips"
          />
          <nut-input
            class="input"
            v-model="headersCacheTtlInput"
            :disabled="!isCacheConfigEditing"
            :placeholder="$t(`myPage.placeholder.headersCacheTtl`)"
            type="number"
            input-align="left"
            :left-icon="iconHeadersCacheTtl"
            right-icon="tips"
            @click-right-icon="headersCacheTtlTips"
          />
          <nut-input
            class="input"
            v-model="scriptCacheTtlInput"
            :disabled="!isCacheConfigEditing"
            :placeholder="$t(`myPage.placeholder.scriptCacheTtl`)"
            type="number"
            input-align="left"
            :left-icon="iconScriptCacheTtl"
            right-icon="tips"
            @click-right-icon="scriptCacheTtlTips"
          />
          <nut-input
            class="input"
            v-model="logsMaxCountInput"
            :disabled="!isCacheConfigEditing"
            :placeholder="$t(`myPage.placeholder.logsMaxCount`)"
            type="number"
            input-align="left"
            :left-icon="iconLogsMaxCount"
            right-icon="tips"
            @click-right-icon="logsMaxCountTips"
          />
        </div>
      </div>
      <div class="config-card">
        <div class="title-wrapper" @click="isFrontEndConfigEditing ? exitEditMode('frontEnd') : toggleEditMode('frontEnd')">
          <h1>{{ $t(`myPage.frontEndConfig`) }}</h1>
          <div class="config-btn-wrapper">
            <nut-button
              v-if="isFrontEndConfigEditing"
              class="cancel-btn"
              plain
              type="info"
              size="mini"
              @click.stop="exitEditMode('frontEnd')"
              :disabled="isEditLoading"
            >
              <font-awesome-icon icon="fa-solid fa-ban" />
              {{ $t(`myPage.btn.cancel`) }}
            </nut-button>
            <nut-button
              v-if="isFrontEndConfigEditing"
              class="save-btn"
              type="primary"
              size="mini"
              @click.stop="toggleEditMode('frontEnd')"
              :loading="isEditLoading"
            >
              <font-awesome-icon
                v-if="!isFrontEndConfigEditing"
                icon="fa-solid fa-pen-to-square"
              />
              <font-awesome-icon
                v-else-if="!isEditLoading && isFrontEndConfigEditing"
                icon="fa-solid fa-floppy-disk"
              />
              {{ !isFrontEndConfigEditing ? $t(`myPage.btn.edit`) : $t(`myPage.btn.save`) }}
            </nut-button>
            <nut-icon v-else class="right-icon" name="right"></nut-icon>
          </div>
        </div>
        <div class="config-input-wrapper" v-if="isFrontEndConfigEditing">

          <nut-input
            class="input"
            v-model="concurrencyInput"
            :disabled="!isFrontEndConfigEditing"
            :placeholder="$t(`myPage.placeholder.concurrency`)"
            type="number"
            input-align="left"
            :left-icon="iconConcurrency"
            right-icon="tips"
            @click-right-icon="concurrencyTips"
          />
          <nut-input
            class="input"
            v-model="concurrencyWaitTimeInput"
            :disabled="!isFrontEndConfigEditing"
            :placeholder="$t(`myPage.placeholder.concurrencyWaitTime`)"
            type="number"
            input-align="left"
            :left-icon="iconTimeout"
            right-icon="tips"
            @click-right-icon="concurrencyWaitTimeTips"
          />
          <nut-input
            class="input"
            v-model="apiCheckTimeoutInput"
            :disabled="!isFrontEndConfigEditing"
            :placeholder="$t(`myPage.placeholder.apiCheckTimeout`)"
            type="number"
            input-align="left"
            :left-icon="iconTimeout"
            right-icon="tips"
            @click-right-icon="apiCheckTimeoutTips"
          />
          <nut-input
            class="input"
            v-model="apiRequestTimeoutInput"
            :disabled="!isFrontEndConfigEditing"
            :placeholder="$t(`myPage.placeholder.apiRequestTimeout`)"
            type="number"
            input-align="left"
            :left-icon="iconTimeout"
            right-icon="tips"
            @click-right-icon="apiRequestTimeoutTips"
          />

        </div>
      </div>

      <nut-cell-group v-if="shareBtnVisible">
        <nut-cell
          :title="$t(`moreSettingPage.shareManageTitle`)"
          class="right-icon"
          @click.stop="onClickShareManage"
          is-link
        ></nut-cell>
      </nut-cell-group>
      <nut-cell-group>
        <nut-cell
          :title="$t(`apiSettingPage.apiSettingTitle`)"
          class="right-icon"
          @click.stop="onClickAPISetting"
          is-link
        ></nut-cell>
        <nut-cell
          :title="$t(`myPage.logsTitle`)"
          class="right-icon"
          @click.stop="onClickLogs"
          is-link
        ></nut-cell>
      </nut-cell-group>
      <nut-cell-group>
        <nut-cell
          :title="$t(`moreSettingPage.moreSettingTitle`)"
          class="right-icon"
          @click.stop="onClickMore"
          is-link
        ></nut-cell>

        <nut-cell
          :title="$t(`navBar.pagesTitle.aboutUs`)"
          class="right-icon"
          @click.stop="onClickAbout"
          is-link
        ></nut-cell>
      </nut-cell-group>
    </div>

    <div class="env-block">
      <img v-if="icon" :src="displayBackendIcon" alt="" class="auto-reverse" />
      <a v-if="env.projectVersion" href="https://github.com/ywainzh/Sub-Store/releases" target="_blank" rel="noopener noreferrer">{{ env.projectVersion }}</a>
      <a
        v-if="env.hasNewVersion"
        target="_blank"
        href="https://github.com/ywainzh/Sub-Store/releases"
        rel="noopener noreferrer"
      >
        <nut-badge value="NEW">v{{ env.version }}</nut-badge>
      </a>
      <p v-else>v{{ env.version }}</p>
      <p>{{ env.meta?.node?.env?.SUB_STORE_BACKEND_CUSTOM_NAME || env.backend }}</p>
    </div>

  </div>
</template>

<script lang="ts" setup>
import { useSettingsApi } from "@/api/settings";
import avatar from "@/assets/icons/avatar.svg?url";
import iconProxy from "@/assets/icons/proxy.svg";
import icongithubProxy from "@/assets/icons/githubProxy.svg";
import iconUA from "@/assets/icons/user-agent.svg";
import iconMax from "@/assets/icons/max.svg";
import iconHeadersCacheTtl from "@/assets/icons/headersCacheTtl.svg";
import iconLogsMaxCount from "@/assets/icons/logsMaxCount.svg";
import iconResourceCacheTtl from "@/assets/icons/resourceCacheTtl.svg";
import iconScriptCacheTtl from "@/assets/icons/scriptCacheTtl.svg";
import iconTimeout from "@/assets/icons/timeout.svg";
import iconConcurrency from "@/assets/icons/concurrency.svg";
import { useAppNotifyStore } from "@/store/appNotify";
import { useGlobalStore } from "@/store/global";
import { useSettingsStore } from "@/store/settings";
import { downloadBlobResponse } from "@/utils/download";
import { createGithubProxyUrlRewriter } from "@/utils/githubProxy";
import { initStores } from "@/utils/initApp";
import { storeToRefs } from "pinia";
import { computed, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useBackend } from "@/hooks/useBackend";
import { useHostAPI } from '@/hooks/useHostAPI';
import LanguageSwitcherButton from "@/components/LanguageSwitcherButton.vue";
import { Dialog, Toast } from '@nutui/nutui';

const { t } = useI18n();

// const route = useRoute();
const router = useRouter();
const { showNotify } = useAppNotifyStore();
const { currentUrl: host } = useHostAPI();
const settingsStore = useSettingsStore();
const {
  defaultUserAgent, defaultFlowUserAgent, defaultProxy, defaultTimeout,
  backendRequestConcurrency, backendRequestConcurrencyWaitTime, cacheThreshold,
  resourceCacheTtl, headersCacheTtl, scriptCacheTtl, logsMaxCount,
  githubProxy, githubProxyRegex,
} = storeToRefs(settingsStore);

const { icon, env } = useBackend();
const githubUrlRewriter = computed(() => {
  return createGithubProxyUrlRewriter(githubProxy.value, githubProxyRegex.value);
});
const displayBackendIcon = computed(() => {
  return githubUrlRewriter.value(
    env.value?.meta?.node?.env?.SUB_STORE_BACKEND_CUSTOM_ICON || icon.value,
  ) || icon.value;
});

const shareBtnVisible = computed(() => {
  return env.value?.feature?.share;
});

const onClickAPISetting = () => {
  router.push(`/settings/api`);
};
const onClickLogs = () => {
  router.push(`/logs`);
};

const onClickShareManage = () => {
  router.push(`/shares`);
};
const onClickMore = () => {
  router.push(`/settings/more`);
};
const onClickAbout = () => {
  router.push(`/aboutUs`);
};


// 编辑 更新
const githubProxyInput = ref("");
const githubProxyRegexInput = ref("");
const uaInput = ref("");
const flowUaInput = ref("");
const proxyInput = ref("");
const timeoutInput = ref("");
const backendRequestConcurrencyInput = ref("");
const backendRequestConcurrencyWaitTimeInput = ref("");
const cacheThresholdInput = ref("");
const resourceCacheTtlInput = ref("");
const headersCacheTtlInput = ref("");
const scriptCacheTtlInput = ref("");
const logsMaxCountInput = ref("");
const concurrencyInput = ref("");
const concurrencyWaitTimeInput = ref("");
const apiCheckTimeoutInput = ref("");
const apiRequestTimeoutInput = ref("");
const isRequestConfigEditing = ref(false);
const isCacheConfigEditing = ref(false);
const isFrontEndConfigEditing = ref(false);
const isEditLoading = ref(false);
const isInit = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const createSettingsPayload = (type: string): SettingsPostData => {
  if (type === "request") {
    return {
      defaultUserAgent: uaInput.value,
      defaultFlowUserAgent: flowUaInput.value,
      defaultProxy: proxyInput.value,
      defaultTimeout: timeoutInput.value,
      githubProxy: githubProxyInput.value,
      githubProxyRegex: githubProxyRegexInput.value,
      backendRequestConcurrency: backendRequestConcurrencyInput.value,
      backendRequestConcurrencyWaitTime: backendRequestConcurrencyWaitTimeInput.value,
    };
  }

  if (type === "cache") {
    return {
      cacheThreshold: cacheThresholdInput.value,
      resourceCacheTtl: resourceCacheTtlInput.value,
      headersCacheTtl: headersCacheTtlInput.value,
      scriptCacheTtl: scriptCacheTtlInput.value,
      logsMaxCount: logsMaxCountInput.value,
    };
  }

  return {};
};

const toggleEditMode = async (type) => {
  isEditLoading.value = true;
  try {
    if ((type === 'request' && isRequestConfigEditing.value) || (type === 'cache' && isCacheConfigEditing.value)) {
      const saveSucceeded = await settingsStore.changeSettings(createSettingsPayload(type));

      if (saveSucceeded) {
        setDisplayInfo();
      }
    } else {
      githubProxyInput.value = githubProxy.value;
      githubProxyRegexInput.value = githubProxyRegex.value;
      uaInput.value = defaultUserAgent.value;
      flowUaInput.value = defaultFlowUserAgent.value || "";
      proxyInput.value = defaultProxy.value;
      timeoutInput.value = defaultTimeout.value;
      backendRequestConcurrencyInput.value = backendRequestConcurrency.value || "";
      backendRequestConcurrencyWaitTimeInput.value = backendRequestConcurrencyWaitTime.value || "";
      cacheThresholdInput.value = cacheThreshold.value;
      resourceCacheTtlInput.value = resourceCacheTtl.value;
      headersCacheTtlInput.value = headersCacheTtl.value;
      scriptCacheTtlInput.value = scriptCacheTtl.value;
      logsMaxCountInput.value = logsMaxCount.value;
    }
    if (type === 'frontEnd' && isFrontEndConfigEditing.value) {
      const apiCheckTimeout = Number(apiCheckTimeoutInput.value);
      if (!isNaN(apiCheckTimeout)) {
        if (apiCheckTimeout > 0) {
          console.log(`设置超时 ${apiCheckTimeout}`)
          localStorage.setItem('timeout', apiCheckTimeout.toString());
        } else {
          console.log(`清除超时设置`)
          localStorage.removeItem('timeout');
        }
      }else {
        console.log(`清除超时设置`)
        localStorage.removeItem('timeout');
      }
      const apiRequestTimeout = Number(apiRequestTimeoutInput.value);
      if (!isNaN(apiRequestTimeout)) {
        if (apiRequestTimeout > 0) {
          console.log(`设置前端请求超时 ${apiRequestTimeout}`)
          localStorage.setItem('apiRequestTimeout', apiRequestTimeout.toString());
        } else {
          console.log(`清除前端请求超时设置`)
          localStorage.removeItem('apiRequestTimeout');
        }
      } else {
        console.log(`清除前端请求超时设置`)
        localStorage.removeItem('apiRequestTimeout');
      }
      const concurrency = parseInt(concurrencyInput.value, 10);
      if (!isNaN(concurrency)) {
        if (concurrency >= 1) {
          console.log(`设置并发数 ${concurrency}`)
          localStorage.setItem('concurrency', concurrency.toString());
        } else {
          console.log(`清除并发数设置`)
          localStorage.removeItem('concurrency');
        }
      } else {
        console.log(`清除并发数设置`)
        localStorage.removeItem('concurrency');
      }
      const concurrencyWaitTime = parseInt(concurrencyWaitTimeInput.value, 10);
      if (!isNaN(concurrencyWaitTime)) {
        if (concurrencyWaitTime > 0) {
          console.log(`设置并发等待时间 ${concurrencyWaitTime}`)
          localStorage.setItem('concurrencyWaitTime', concurrencyWaitTime.toString());
        } else {
          console.log(`清除并发等待时间设置`)
          localStorage.removeItem('concurrencyWaitTime');
        }
      } else {
        console.log(`清除并发等待时间设置`)
        localStorage.removeItem('concurrencyWaitTime');
      }
      setTimeout(() => {
        window.location.reload();
      }, 100);
    } else {
      const storedTimeout = localStorage.getItem('timeout');
      if (storedTimeout) {
        apiCheckTimeoutInput.value = storedTimeout;
      } else {
        apiCheckTimeoutInput.value = '';
      }
      const storedApiRequestTimeout = localStorage.getItem('apiRequestTimeout');
      if (storedApiRequestTimeout) {
        apiRequestTimeoutInput.value = storedApiRequestTimeout;
      } else {
        apiRequestTimeoutInput.value = '';
      }
      const storedConcurrency = localStorage.getItem('concurrency');
      if (storedConcurrency) {
        concurrencyInput.value = storedConcurrency;
      } else {
        concurrencyInput.value = '';
      }
      const storedConcurrencyWaitTime = localStorage.getItem('concurrencyWaitTime');
      if (storedConcurrencyWaitTime) {
        concurrencyWaitTimeInput.value = storedConcurrencyWaitTime;
      } else {
        concurrencyWaitTimeInput.value = '';
      }
    }
    if (type === 'cache' && !isCacheConfigEditing.value) {
      isCacheConfigEditing.value = !isCacheConfigEditing.value;
    } else if (type === 'request' && !isRequestConfigEditing.value) {
      isRequestConfigEditing.value = !isRequestConfigEditing.value;
    } else if (type === 'frontEnd' && !isFrontEndConfigEditing.value) {
      isFrontEndConfigEditing.value = !isFrontEndConfigEditing.value;
    }
  } catch (e) {
    showNotify({
      title: `更新配置失败`,
      type: "danger",
    });
    console.error(e);
  } finally {
    isEditLoading.value = false;
  }
};

const exitEditMode = (type) => {
  setDisplayInfo();
  if (type === 'cache') {
    isCacheConfigEditing.value = false;
  } else if (type === 'request') {
    isRequestConfigEditing.value = false;
  } else {
    isFrontEndConfigEditing.value = false;
  }
  isEditLoading.value = false;
};
const setDisplayInfo = () => {
  githubProxyInput.value = githubProxy.value || "";
  githubProxyRegexInput.value = githubProxyRegex.value || "";
  uaInput.value = defaultUserAgent.value || "";
  flowUaInput.value = defaultFlowUserAgent.value || "";
  proxyInput.value = defaultProxy.value || "";
  timeoutInput.value = defaultTimeout.value || "";
  backendRequestConcurrencyInput.value = backendRequestConcurrency.value || "";
  backendRequestConcurrencyWaitTimeInput.value = backendRequestConcurrencyWaitTime.value || "";
  cacheThresholdInput.value = cacheThreshold.value || "";
  resourceCacheTtlInput.value = resourceCacheTtl.value || "";
  headersCacheTtlInput.value = headersCacheTtl.value || "";
  scriptCacheTtlInput.value = scriptCacheTtl.value || "";
  logsMaxCountInput.value = logsMaxCount.value ?? "";
};

// 本地备份与恢复
const restoreIsLoading = ref(false);
const backupIsLoading = ref(false);
const downloadBackup = async () => {
  backupIsLoading.value = true;
  try {
    const res = await useSettingsApi().downloadBackup();
    downloadBlobResponse(res, 'sub-store_data.json');
    showNotify({
      type: "success",
      title: t(`myPage.notify.download.succeed`),
    });
  } catch (e) {
    showNotify({
      type: "danger",
      title: t(`myPage.notify.download.failed`),
    });
    console.error(e);
  } finally {
    backupIsLoading.value = false;
  }
};
const fileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    restoreIsLoading.value = true;
    const res = await useSettingsApi().restoreSettings({ content: await file.text() });
    if (res?.data?.status === "success") {
      await initStores(false, true, true);
      showNotify({
        type: "success",
        title: t(`myPage.notify.restore.succeed`),
      });

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      throw new Error('restore failed');
    }
  } catch (e) {
    showNotify({
      type: "danger",
      title: t(`myPage.notify.restore.failed`),
    });
    console.error(e);
  } finally {
    restoreIsLoading.value = false;
    input.value = '';
  }
};
const upload = () => fileInput.value?.click();

const githubProxyTips = () => {
  Dialog({
      title: '请填写完整 GitHub 加速代理地址',
      content: '填写完整代理地址，例如 https://a.com。配置匹配正则后，匹配的远程资源下载地址会改写为 https://a.com/原始URL。',
      popClass: 'auto-dialog',
      textAlign: 'left',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const githubProxyRegexExample = '^https?:\\/\\/.+\\.(githubusercontent|github)\\.com($|\\/)';
const githubProxyRegexTips = () => {
  Dialog({
      title: '按正则匹配下载链接',
      content: `后端需 >= 2.21.75\n\n1. 需先配置上方 GitHub 加速代理, 本项才会生效\n\n2. 对匹配正则的远程资源 URL 生效\n\n3. 默认忽略大小写, 例如\n${githubProxyRegexExample}\n\n4. 会把匹配的下载地址改写为\nhttps://a.com/原始URL\n\n5. 使用此方式时, 自行注意安全隐私问题`,
      popClass: 'auto-dialog',
      textAlign: 'left',
      okText: 'OK',
      cancelText: '填入示例正则',
      onCancel: () => {
        githubProxyRegexInput.value = githubProxyRegexExample;
        Toast.text('已填入示例正则，请自行保存', { duration: 3000 });
      },
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const proxyTips = () => {
  Dialog({
      title: '通过代理/节点/策略进行下载',
      content: '1. Surge/Egern(参数 policy/policy-descriptor)\n\n可设置节点代理 例: Test = snell, 1.2.3.4, 80, psk=password, version=4\n\n或设置策略/节点 例: 国外加速\n\n2. Loon(参数 node)\n\nLoon 官方文档: \n\n指定该请求使用哪一个节点或者策略组（可以是节点名称、策略组名称，也可以是一个 Loon 格式的节点描述，如：shadowsocksr,example.com,1070,chacha20-ietf,"password",protocol=auth_aes128_sha1,protocol-param=test,obfs=plain,obfs-param=edge.microsoft.com）\n\n3. Stash(参数 headers["X-Surge-Policy"])/Shadowrocket(参数 headers.X-Surge-Policy)/QX(参数 opts.policy)\n\n可设置策略/节点\n\n4. Node.js 版(http/https/socks5):\n\n例: socks5://a:b@127.0.0.1:7890\n\n※ 优先级由高到低: 单条订阅, 组合订阅, 默认配置\n\n完整说明 请查看 https://telegram.me/zhetengsha/1843',
      popClass: 'auto-dialog',
      textAlign: 'left',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const uaTips = () => {
  Dialog({
      title: '默认为 clash.meta',
      content: '可尝试设置为 clash-verge/v2.4.6, v2rayNG 等客户端的 User-Agent 让机场后端下发更多协议(可根据实际情况改成最新版本号)。也可在单条订阅里设置单独的 User-Agent',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const flowUaTips = () => {
  Dialog({
      title: '查询订阅流量信息 的 User-Agent',
      content: '若机场后端不给默认 UA 下发订阅流量信息, 可改为 "Quantumult%20X/1.0.30 (iPhone14,2; iOS 15.6)"。也可在单条订阅里的远程链接参数里设置单独的 flowUserAgent',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const timeoutTips = () => {
  Dialog({
      title: '可尝试设置为 3000~4000',
      content: '防止拉取结果的总时长超过代理 app 加载外部资源的最大等待时长, 确保拉取成功',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const backendRequestConcurrencyTips = () => {
  Dialog({
      title: '后端请求并发数',
      content: '后端需 >= 2.23.32\n\n控制后端发起外部请求时的并发数。默认 10；在代理 App 中建议不超过 20，过高可能增加连接数和内存压力。\n\n实际会用于远程资源下载，例如远程订阅、文件、脚本、预览等经后端下载工具发起的请求；也会用于订阅流量信息请求，例如 Subscription-Userinfo 的 HEAD/GET 请求。\n\n域名解析除外，它有自己的请求并发数。\n\n后端日志会输出 [Backend Request Concurrency]，包含 active、pending、limit、waitTime，方便调试。',
      popClass: 'auto-dialog',
      textAlign: 'left',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const backendRequestConcurrencyWaitTimeTips = () => {
  Dialog({
      title: '后端请求并发等待时间',
      content: '后端需 >= 2.23.32\n\n每个受后端请求并发数限制的请求拿到并发槽后，先等待指定毫秒数再发出。默认 0。\n\n可用于降低代理 App 中后端请求的瞬时连接压力；数值越大，总处理耗时也会越长。\n\n作用范围与后端请求并发数一致：远程资源下载和订阅流量信息请求。域名解析除外，它有自己的请求并发数。',
      popClass: 'auto-dialog',
      textAlign: 'left',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const cacheThresholdTips = () => {
  Dialog({
      title: '可尝试设置为 1024',
      content: '下载资源过大时\n若要写入缓存\n代理 app 可能会崩溃重启\n可尝试设置此值',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const resourceCacheTtlTips = () => {
  Dialog({
      title: '资源缓存时间 (秒)',
      content: '主要涉及下载订阅/下载脚本/域名解析等功能',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const headersCacheTtlTips = () => {
  Dialog({
      title: '响应头缓存时间 (秒)',
      content: '主要涉及订阅流量信息等功能',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const scriptCacheTtlTips = () => {
  Dialog({
      title: '脚本缓存时间 (秒)',
      content: '主要涉及在脚本中使用的 scriptResourceCache 缓存',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const logsMaxCountTips = () => {
  Dialog({
      title: '最大保存日志条数',
      content: '默认 0，即关闭日志缓存读写。设为大于 0 后，后端会把日志写入持久化缓存；数值越大占用的缓存空间越多，也可能影响性能。',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const concurrencyTips = () => {
  Dialog({
      title: '并发数',
      content: 'Shadowrocket/Surge 等代理 App 中并发数太高可能会爆内存, 可自行调整',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const concurrencyWaitTimeTips = () => {
  Dialog({
      title: '并发等待时间',
      content: '每个受并发限制的前端请求拿到并发槽后，等待指定毫秒数再发出。默认 0 毫秒。',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const apiCheckTimeoutTips = () => {
  Dialog({
      title: 'API 检测超时',
      content: '某些版本的 Mac 上 QX https://sub.store/api/utils/env 可能会超时, JS 一直活跃中, 可设为 8000',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
const apiRequestTimeoutTips = () => {
  Dialog({
      title: '前端请求超时',
      content: '控制前端 axios 请求后端接口的超时时间。默认 50000 毫秒，设为大于 0 的值后保存并刷新生效。',
      popClass: 'auto-dialog',
      okText: 'OK',
      noCancelBtn: true,
      closeOnPopstate: true,
      lockScroll: false,
    });
};
// store 刷新数据完成后 复制内容给 input 绑定
const { isLoading: storeIsLoading, env: backendEnv } = storeToRefs(useGlobalStore());
watchEffect(() => {
  if (!storeIsLoading.value && !isInit.value) {
    setDisplayInfo();
    isInit.value = true;
  }
});
</script>

<style lang="scss" scoped>
.my-page-wrapper {
  min-height: 100%;
  padding: var(--safe-area-side);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;

  .profile-block {
    width: 100%;

    .profile-toolbar {
      display: flex;
      justify-content: flex-end;
      align-items: center;
    }

    .config-card {
      margin-top: 10px;
      width: 100%;
      padding: 6px 12px 6px 6px;
      border-radius: var(--item-card-radios);
      color: var(--second-text-color);
      background: var(--card-color);

      .title-wrapper {
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 0 0 10px;
      }

      h1 {
        font-size: 14px;
        padding: 8px 0 2px 0;
        margin-bottom: 8px;
      }

      .config-input-wrapper {
        .input.nut-input-disabled {
          :deep(input):disabled {
            -webkit-text-fill-color: var(--lowest-text-color);
          }
        }

        .input {
          background: transparent;
          padding: 12px;
          color: var(--second-text-color);

          :deep(img) {
            width: 16px;
            height: 16px;
            margin-right: 6px;
            opacity: 0.2;
            filter: brightness(var(--img-brightness));
          }
          :deep(.nut-icon-tips:before) {
            cursor: pointer;
          }
          &:not(:first-child) {
            margin-top: 8px;
          }
        }
      }

      .config-btn-wrapper {
        display: flex;
        justify-content: flex-end;

        .cancel-btn {
          background: transparent;
        }

        .save-btn {
          margin-left: 8px;
        }
      }
    }

    .info {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0 0 0;
      margin-bottom: 20px;

      .avatar-wrapper {
        display: flex;
        align-items: center;
        max-width: 64%;

        :deep(.nut-avatar) {
          background: var(--card-color);
        }

        .avatar-fallback {
          :deep(img),
          :deep(.nut-icon__img) {
            width: 72%;
            height: 72%;
            object-fit: contain;
          }
        }

        .name {
          margin-left: 12px;
          font-size: 18px;
          font-weight: bold;
          max-width: 64%;
          display: flex;
          flex-direction: column;

          p.title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--primary-text-color);
          }

          .des {
            margin-top: 6px;
            font-size: 12px;
            font-weight: normal;
            display: flex;
            flex-direction: column;
            color: var(--comment-text-color);
          }
        }

      }

      .actions {
        margin-left: 12px;
        display: flex;
        flex-direction: column;

        svg {
          margin-right: 4px;
        }

        .upload-btn,
        .download-btn {
          padding: 0 10px;
          width: 116px;
        }

        .upload-btn {
          background: transparent;
        }

        .download-btn {
          margin-top: 12px;
        }
      }
    }

    .right-icon {
      // color: var(--comment-text-color);
      box-shadow: none;
      font-weight: bold;
    }
  }

  .env-block {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    font-size: 12px;
    color: var(--lowest-text-color);

    img {
      opacity: 0.4;
      width: 54px;
      height: 54px;
    }
  }
}

.nut-icon {
  color: var(--lowest-text-color);
}

</style>
