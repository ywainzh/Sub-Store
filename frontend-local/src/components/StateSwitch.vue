<template>
  <button
    type="button"
    class="state-switch"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :aria-busy="loading"
    :disabled="disabled || loading"
    :title="label"
    @mousedown.stop
    @pointerdown.stop
    @touchstart.stop
    @click.stop="emit('update:modelValue', !modelValue)"
  >
    <span class="switch-track" :class="{ on: modelValue }" aria-hidden="true">
      <span class="switch-thumb" :class="{ loading }" />
    </span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label: string;
  loading?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
}>();
</script>

<style scoped lang="scss">
.state-switch {
  flex: 0 0 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  vertical-align: middle;
  &:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }
  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
}
.switch-track {
  width: 36px;
  height: 20px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 20px;
  background: var(--comment-text-color);
  transition: background-color 0.15s ease;
  &.on {
    background: var(--primary-color);
  }
}
.switch-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--card-color);
  transition: transform 0.15s ease;
  .on & {
    transform: translateX(16px);
  }
  &.loading {
    opacity: 0.6;
  }
}
@media (prefers-reduced-motion: reduce) {
  .switch-track,
  .switch-thumb {
    transition: none;
  }
}
</style>
