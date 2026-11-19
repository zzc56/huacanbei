<template>
  <header class="top-banner">
    <div class="banner-left">
      <span class="radar-pulse" />
      <h1 class="banner-title">雷达研究上位机 v0.3.6</h1>
      <StatusBadge :tone="badgeTone">{{ badgeText }}</StatusBadge>
    </div>
    <div class="banner-right">
      <RouterLink to="/" class="portal-link">返回作品官网</RouterLink>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRadarStore } from '@/stores/radar';
import { COPY } from '@/types';
import StatusBadge from '@/components/ui/StatusBadge.vue';

const radarStore = useRadarStore();

const badgeText = computed(() => {
  if (radarStore.status.sourceKind === 'synthetic_self_test') {
    return COPY.SYNTHETIC_BADGE;
  }
  if (radarStore.status.state === 'Replay' || radarStore.status.sourceKind === 'replay') {
    return COPY.REPLAY_BADGE;
  }
  return COPY.PROTOTYPE_BADGE;
});

const badgeTone = computed(() => {
  if (radarStore.status.sourceKind === 'synthetic_self_test') return 'warn';
  if (radarStore.status.state === 'Replay') return 'neutral';
  if (radarStore.status.connected) return 'ok';
  return 'neutral';
});
</script>

<style scoped>
.top-banner {
  height: 44px;
  background: var(--c-canvas);
  color: var(--c-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--c-grid);
}

.banner-left {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.radar-pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-teal);
  box-shadow: var(--glow-teal);
}

.banner-title {
  font-size: var(--fs-h2);
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--c-surface);
}

.portal-link {
  font-size: var(--fs-cap);
  color: var(--c-ink-3);
  text-decoration: none;
  padding: 4px 10px;
  border: 1px solid var(--c-grid);
  border-radius: var(--r-sm);
  transition: all 0.15s ease;
}

.portal-link:hover {
  color: var(--c-teal);
  border-color: var(--c-teal);
}
</style>
