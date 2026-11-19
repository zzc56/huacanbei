<template>
  <span class="status-badge" :class="`tone-${tone}`">
    <span class="dot" />
    <span class="text"><slot /></span>
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'ok' | 'neutral' | 'danger' | 'warn';
  }>(),
  {
    tone: 'neutral'
  }
);
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--fs-cap);
  font-weight: 600;
  background: var(--c-surface-alt);
  color: var(--c-ink-2);
  border: 1px solid var(--c-border);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-ink-2);
}

.tone-ok {
  background: var(--c-ok-soft);
  color: var(--c-ok);
  border-color: rgba(22, 116, 80, 0.25);
}

.tone-ok .dot {
  background: var(--c-ok);
  box-shadow: 0 0 6px rgba(22, 116, 80, 0.6);
}

.tone-danger {
  background: var(--c-danger-soft);
  color: var(--c-danger);
  border-color: rgba(175, 45, 45, 0.25);
}

.tone-danger .dot {
  background: var(--c-danger);
}

.tone-warn {
  background: var(--c-warn-soft);
  color: var(--c-warn-ink);
  border-color: rgba(250, 191, 92, 0.45);
}

.tone-warn .dot {
  background: var(--c-amber);
}
</style>
