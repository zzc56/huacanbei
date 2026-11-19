<template>
  <section class="card-panel" :class="{ dense }">
    <header v-if="title || $slots.header" class="card-header">
      <h2 v-if="title" class="card-title">{{ title }}</h2>
      <slot name="header" />
    </header>
    <div class="card-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  dense?: boolean;
}>();
</script>

<style scoped>
.card-panel {
  background: var(--c-surface);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  box-shadow: var(--shadow-card);
  border: 1px solid var(--c-border);
}

.card-panel.dense {
  padding: var(--sp-2) var(--sp-3);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
  gap: var(--sp-2);
}

.card-title {
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ink);
}
</style>
