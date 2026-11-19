<template>
  <button
    :type="type"
    class="app-btn"
    :class="[`variant-${variant}`, { compact }]"
    :disabled="disabled"
    :aria-label="ariaLabel || undefined"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'default' | 'danger' | 'ghost';
    compact?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    ariaLabel?: string;
  }>(),
  {
    variant: 'default',
    compact: false,
    disabled: false,
    type: 'button',
    ariaLabel: ''
  }
);

defineEmits<{
  (e: 'click', ev: MouseEvent): void;
}>();
</script>

<style scoped>
.app-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  height: 31px;
  padding: 0 var(--sp-3);
  font-size: var(--fs-body);
  font-weight: 500;
  border-radius: var(--r-sm);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  color: var(--c-ink);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  user-select: none;
}

.app-btn.compact {
  height: 29px;
  padding: 0 var(--sp-2);
  font-size: var(--fs-cap);
}

.app-btn:hover:not(:disabled) {
  background: var(--c-row-alt);
  border-color: var(--c-axis);
}

.app-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.app-btn.variant-primary {
  background: var(--c-ok-soft);
  color: var(--c-ok);
  border-color: var(--c-ok);
  font-weight: 600;
}

.app-btn.variant-primary:hover:not(:disabled) {
  filter: brightness(0.97);
}

.app-btn.variant-danger {
  background: var(--c-surface);
  color: var(--c-danger);
  border-color: var(--c-danger);
}

.app-btn.variant-danger:hover:not(:disabled) {
  background: var(--c-danger-soft);
}

.app-btn.variant-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--c-ink-2);
}

.app-btn.variant-ghost:hover:not(:disabled) {
  background: var(--c-head);
  color: var(--c-ink);
}

.app-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
</style>
