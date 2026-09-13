<template>
  <div class="login-page">
    <div class="login-content">
      <h1>Sub-Store</h1>
      <p class="intro">登录管理你的订阅</p>
      <form class="login-card" @submit.prevent="submit">
        <label for="admin-username">账号</label>
        <input id="admin-username" value="admin" autocomplete="username" readonly />
        <label for="admin-password">密码</label>
        <input id="admin-password" v-model="password" type="password" autocomplete="current-password" required :disabled="busy" autofocus />
        <p class="session-hint">登录状态保留 30 天</p>
        <p v-if="error || authState.error" class="login-error" role="alert">{{ error || authState.error }}</p>
        <ActionButton block type="primary" native-type="submit" :loading="busy" :disabled="busy || !password">登录</ActionButton>
      </form>
      <button v-if="authState.error" class="retry-button" type="button" :disabled="busy" @click="retry">重新连接服务器</button>
      <a href="https://github.com/ywainzh/Sub-Store" target="_blank" rel="noopener noreferrer">项目与使用文档</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import ActionButton from '@/components/ActionButton.vue';
import { authState, ensureAuthentication, login } from '@/utils/managementAuth';

const route = useRoute();
const password = ref('');
const busy = ref(false);
const error = ref('');
const redirect = () => {
  const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/subs';
  window.location.replace(target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login') && !target.includes('\\') ? target : '/subs');
};
async function retry() {
  busy.value = true;
  try { if (await ensureAuthentication(true)) redirect(); }
  finally { busy.value = false; }
}
async function submit() {
  if (busy.value || !password.value) return;
  busy.value = true;
  error.value = '';
  try { await login(password.value); password.value = ''; redirect(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '登录失败，请重试'; }
  finally { busy.value = false; }
}
</script>

<style scoped lang="scss">
.login-page { min-height: 100dvh; display: grid; place-items: center; padding: 28px var(--safe-area-side, 20px); }
.login-content { width: min(100%, 390px); }
h1 { font-size: 28px; font-weight: 700; margin: 0 0 8px; }
.intro { opacity: .65; margin-bottom: 24px; }
.login-card { background: var(--card-color); border-radius: var(--item-card-radios, 16px); padding: 24px; }
label { display: block; font-size: 14px; margin-bottom: 8px; }
input { width: 100%; min-height: 44px; padding: 10px 12px; margin-bottom: 18px; border: 1px solid var(--nut-border-color, #9995); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
input:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
input[readonly] { opacity: .65; }
.session-hint { opacity: .65; font-size: 13px; margin-bottom: 18px; }
.login-error { color: var(--nut-danger-color, #e95b63); font-size: 13px; margin-bottom: 16px; overflow-wrap: anywhere; }
a, .retry-button { display: block; margin: 20px auto 0; text-align: center; color: var(--primary-color); font-size: 13px; }
.retry-button { background: none; border: 0; min-height: 44px; cursor: pointer; }
</style>
