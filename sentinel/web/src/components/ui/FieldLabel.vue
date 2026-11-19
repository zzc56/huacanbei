<template>
  <span class="field-label" :title="tooltip || undefined">
    <slot />
  </span>
</template>

<script setup lang="ts">
defineProps<{
  tooltip?: string;
}>();
</script>

<style scoped>
.field-label {
  font-size: var(--fs-cap);
  font-weight: 600;
  color: var(--c-ink);
  white-space: nowrap;
}
</style>
