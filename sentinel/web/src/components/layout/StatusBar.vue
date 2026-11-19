<template>
  <footer class="status-bar-card">
    <div class="status-grid">
      <div class="status-cell">
        <StatusBadge :tone="connTone">连接：{{ connText }}</StatusBadge>
      </div>
      <div class="status-cell tabular-nums">
        网络接收：{{ status.bytesReceived.toLocaleString() }} 字节
      </div>
      <div class="status-cell tabular-nums">
        目标事件：{{ status.targetCount }} 报文：{{ status.messageCount }}
      </div>
      <div class="status-cell tabular-nums">
        最近接收：{{ lastTimeText }}
      </div>
      <div class="status-cell">
        <StatusBadge :tone="status.recording ? 'ok' : 'neutral'">
          保存：{{ status.recording ? '进行中' : '未开启' }}
        </StatusBadge>
      </div>
      <div class="status-cell" :class="{ 'fault-text': status.state === 'Faulted' }">
        {{ faultText }}
      </div>
    </div>
    <div class="session-row">
      {{ status.sessionDirectory ? `实验文件夹：${status.sessionDirectory}` : COPY.SESSION_DIR_EMPTY }}
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HostStatus } from '@/types';
import { COPY } from '@/types';
import { formatTimeHmsMs } from '@/utils/format';
import StatusBadge from '@/components/ui/StatusBadge.vue';

const props = defineProps<{
  status: HostStatus;
}>();

const connText = computed(() => {
  switch (props.status.state) {
    case 'Connected':
      return '已连接';
    case 'Connecting':
      return '正在连接…';
    case 'Replay':
      return '离线回放';
    case 'Faulted':
      return '连接异常';
    default:
      return '未连接';
  }
});

const connTone = computed(() => {
  if (props.status.state === 'Connected') return 'ok';
  if (props.status.state === 'Faulted') return 'danger';
  if (props.status.state === 'Replay') return 'warn';
  return 'neutral';
});

const lastTimeText = computed(() => {
  if (!props.status.lastReceiveUtc) return '—';
  return formatTimeHmsMs(props.status.lastReceiveUtc);
});

const faultText = computed(() => {
  if (props.status.state === 'Faulted') {
    return `异常：${props.status.message}`;
  }
  return '异常：无';
});
</script>

<style scoped>
.status-bar-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--shadow-card);
  font-size: var(--fs-cap);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-1) var(--sp-3);
  padding-bottom: var(--sp-1);
  border-bottom: 1px solid var(--c-head);
}

.status-cell {
  display: flex;
  align-items: center;
  min-height: 24px;
  color: var(--c-ink);
}

.fault-text {
  color: var(--c-danger);
  font-weight: 600;
}

.session-row {
  padding-top: var(--sp-1);
  color: var(--c-ink-2);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
</style>
