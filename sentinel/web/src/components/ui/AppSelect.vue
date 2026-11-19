<template>
  <select
    class="app-select"
    :value="modelValue"
    :disabled="disabled"
    :aria-label="ariaLabel || '下拉选择'"
    @change="onChange"
  >
    <option v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  options: { label: string; value: string }[];
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
}>();

function onChange(ev: Event): void {
  const target = ev.target as HTMLSelectElement;
  emit('update:modelValue', target.value);
}
</script>

<style scoped>
.app-select {
  height: 31px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: var(--fs-body);
  cursor: pointer;
}

.app-select:focus {
  outline: var(--focus-ring);
  border-color: var(--c-teal);
}
</style>
