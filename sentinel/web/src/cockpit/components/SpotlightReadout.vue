<script setup lang="ts">
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { onBeforeUnmount, ref, watchEffect } from 'vue';
import SpotlightCard from './react-bits/SpotlightCard';

const props = defineProps<{ label: string; value: string; elevated?: boolean }>();
const host = ref<HTMLDivElement>();
let root: Root | undefined;
watchEffect(() => {
  if (!host.value) return;
  root ??= createRoot(host.value);
  root.render(createElement(SpotlightCard, {
    className: 'drive-readout', spotlightColor: '#88cfff', spotlightSize: 130, proximity: 0,
    intensity: .18, borderGlow: .35, flare: false,
  }, createElement('span', null, props.label),
  createElement('strong', { className: props.elevated ? 'elevated' : undefined }, props.value)));
});
onBeforeUnmount(() => root?.unmount());
</script>

<template><div ref="host" /></template>

<style scoped>
:deep(.drive-readout) {
  --spotlight-card-surface: #132638 !important;
  --spotlight-card-border: #ffffff24 !important;
  --spotlight-card-shadow: none !important;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border-radius: 4px; color: #b7c7d4; font-size: 12px;
}
:deep(.drive-readout strong) { color: #d6f5ff; font-size: 21px; font-weight: 650; font-variant-numeric: tabular-nums; }
:deep(.drive-readout strong.elevated) { color: #ffb967; }
</style>
