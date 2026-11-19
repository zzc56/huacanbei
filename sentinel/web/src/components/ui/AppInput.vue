<template>
  <input
    class="app-input"
    :class="{ compact, readonly }"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :min="min"
    :max="max"
    :step="step"
    :aria-label="ariaLabel || placeholder || '输入框'"
    @input="onInput"
    @change="$emit('change', modelValue)"
  />
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    compact?: boolean;
    min?: number;
    max?: number;
    step?: number;
    ariaLabel?: string;
  }>(),
  {
    type: 'text',
    placeholder: '',
    disabled: false,
    readonly: false,
    compact: false,
    ariaLabel: ''
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number): void;
  (e: 'change', v: string | number): void;
}>();

function onInput(ev: Event): void {
  const target = ev.target as HTMLInputElement;
  if (props.type === 'number') {
    const num = Number(target.value);
    emit('update:modelValue', Number.isNaN(num) ? 0 : num);
  } else {
    emit('update:modelValue', target.value);
  }
}
</script>

<style scoped>
.app-input {
  height: 31px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: var(--fs-body);
  width: 100%;
  transition: border-color 0.15s ease;
}

.app-input.compact {
  height: 29px;
  font-size: var(--fs-cap);
}

.app-input:focus {
  outline: var(--focus-ring);
  border-color: var(--c-teal);
}

.app-input:disabled,
.app-input.readonly {
  background: var(--c-surface-alt);
  color: var(--c-ink-2);
  cursor: not-allowed;
}
</style>
