<template>
  <label class="app-checkbox" :title="title">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="label-text"><slot /></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'change', v: boolean): void;
}>();

function onChange(ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked;
  emit('update:modelValue', checked);
  emit('change', checked);
}
</script>

<style scoped>
.app-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  cursor: pointer;
  font-size: var(--fs-cap);
  color: var(--c-ink);
  user-select: none;
}

.app-checkbox input {
  width: 15px;
  height: 15px;
  accent-color: var(--c-ok);
  cursor: pointer;
}
</style>
