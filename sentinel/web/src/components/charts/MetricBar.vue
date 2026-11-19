<template>
  <section class="metric-bar">
    <div class="metric-grid">
      <div class="metric-cell">
        <StatusBadge :tone="stateTone">检测：{{ status.state }}</StatusBadge>
      </div>
      <div class="metric-cell tabular-nums">
        {{ metricText }}
      </div>
      <div class="metric-cell tabular-nums">
        {{ timeText }}
      </div>
      <div class="metric-cell">
        <StatusBadge :tone="status.recording ? 'ok' : 'neutral'">
          保存：{{ status.recording ? '进行中' : '未开启' }}
        </StatusBadge>
      </div>
      <div class="metric-cell span-2">
        提示：{{ status.message }}
      </div>
    </div>
    <div class="session-row">
      {{ status.sessionDirectory ? `实验文件夹：${status.sessionDirectory}` : COPY.SESSION_DIR_EMPTY }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VisionFrame, VisionStatus } from '@/types';
import { COPY } from '@/types';
import { formatTimeHmsMs } from '@/utils/format';
import StatusBadge from '@/components/ui/StatusBadge.vue';

const props = defineProps<{
  status: VisionStatus;
  frame: VisionFrame | null;
  personCount: number;
  vehicleCount: number;
}>();

const stateTone = computed(() => {
  if (props.status.state === 'running') return 'ok';
  if (props.status.state === 'error') return 'danger';
  return 'neutral';
});

const metricText = computed(() => {
  if (!props.frame || !props.status.running) {
    return COPY.VISION_METRIC_EMPTY;
  }
  return `当前帧行人 / 车辆：${props.personCount} / ${props.vehicleCount}   画面：${props.frame.width}×${props.frame.height}   推理：${props.frame.inferenceMs} ms`;
});

const timeText = computed(() => {
  if (!props.frame || !props.status.running) {
    return COPY.VISION_TIME_EMPTY;
  }
  return `处理时刻：${formatTimeHmsMs(props.frame.capturedUtc)}`;
});
</script>

<style scoped>
.metric-bar {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--shadow-card);
  font-size: var(--fs-cap);
}

.metric-grid {
  display: grid;
  grid-template-columns: 220px 1fr 220px;
  gap: var(--sp-1) var(--sp-3);
  padding-bottom: var(--sp-1);
  border-bottom: 1px solid var(--c-head);
}

.metric-cell {
  display: flex;
  align-items: center;
  min-height: 24px;
  color: var(--c-ink);
}

.metric-cell.span-2 {
  grid-column: span 2;
  color: var(--c-ink-2);
}

.session-row {
  padding-top: var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
  font-family: var(--font-mono);
}
</style>
