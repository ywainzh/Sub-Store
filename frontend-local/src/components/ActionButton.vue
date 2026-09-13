<template>
  <button
    :type="nativeType"
    class="nut-button nut-button--round"
    :class="[`nut-button--${type}`, `nut-button--${size}`, { 'nut-button--plain': type === 'default', 'nut-button--block': block, 'nut-button--disabled': disabled || loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading"
  >
    <span class="action-button-content"><nut-icon v-if="loading" name="loading" class="nut-icon-am-rotate" size="14" aria-hidden="true" /><slot /></span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  type?: 'primary' | 'default'; size?: 'small' | 'normal'; nativeType?: 'button' | 'submit';
  block?: boolean; disabled?: boolean; loading?: boolean;
}>(), { type: 'default', size: 'normal', nativeType: 'button', block: false, disabled: false, loading: false });
</script>

<style scoped>
.nut-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 0; margin: 0; padding: 0 18px; font-family: inherit; font-size: 14px; line-height: 1.3; white-space: nowrap; cursor: pointer; }
.nut-button:disabled { cursor: default; }
.nut-button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 3px; }
.action-button-content { display: inline-flex; align-items: center; justify-content: center; gap: 8px; white-space: nowrap; }
</style>
