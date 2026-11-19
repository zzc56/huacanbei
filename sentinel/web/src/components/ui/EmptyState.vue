<template>
  <div class="empty-state">
    <p class="empty-title">{{ title }}</p>
    <p v-if="subtitle" class="empty-sub">{{ subtitle }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  text-align: center;
  color: var(--c-ink-2);
}

.empty-title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--c-ink);
}

.empty-sub {
  margin-top: var(--sp-1);
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
}
</style>
