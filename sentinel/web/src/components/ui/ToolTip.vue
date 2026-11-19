<template>
  <span class="tooltip-wrap" :title="content">
    <slot />
    <span class="tooltip-bubble" role="tooltip">{{ content }}</span>
  </span>
</template>

<script setup lang="ts">
defineProps<{
  content: string;
}>();
</script>

<style scoped>
.tooltip-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.tooltip-bubble {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--c-canvas);
  color: var(--c-ink-3);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  white-space: nowrap;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 40;
  box-shadow: var(--shadow-elevated);
}

.tooltip-wrap:hover .tooltip-bubble {
  opacity: 1;
}
</style>
