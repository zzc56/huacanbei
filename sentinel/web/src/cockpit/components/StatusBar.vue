<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { useSceneStore } from '../stores/scene';
import AnimatedMetric from './AnimatedMetric.vue';
import CockpitBrand from './CockpitBrand.vue';
import UiIcon from './UiIcon.vue';
const props = defineProps<{switchTo: RouteLocationRaw; vehicle?:boolean; radarOnly?:boolean; statusText?:string}>();
const store = useSceneStore(),
  now = ref(new Date()),
  full = ref(false),
  notice = ref('');
let timer: ReturnType<typeof setInterval>, noticeTimer: ReturnType<typeof setTimeout>;
const clock = computed(() =>
  now.value.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }),
);
const date = computed(() => now.value.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
const liveStatus = computed(()=>{
  const live=store.frame.live;if(!live)return '';
  const radar=live.radar.state==='streaming',camera=live.camera.state==='streaming';
  if (radar) return camera ? '雷达 / 摄像头在线' : '实物雷达在线';
  const cameraLabel = camera ? '摄像头在线 · ' : '';
  if (live.radar.state === 'unconfigured') return cameraLabel + '雷达未配置';
  if (live.radar.state === 'awaiting-data') return cameraLabel + '等待雷达报文';
  if (live.radar.state === 'stale') return cameraLabel + '雷达数据超时';
  return camera ? cameraLabel + '雷达待连接' : '等待设备连接';
});
const status = computed(
  () =>
    (store.connection==='connected' && store.frame.live ? liveStatus.value : {
      mock: '模拟数据运行',
      replay: '实测数据回放',
      connecting: '数据连接中',
      connected: '数据流已连接',
      disconnected: '数据流已断开',
      error: '数据接口异常',
    }[store.connection]),
);
const displayedStatus = computed(() => {
  if (store.playing) return status.value;
  if (store.frame.source === 'live') return '显示已冻结 · 采集继续';
  return store.connection === 'replay' ? '回放已暂停' : status.value;
});
function syncFull() {
  full.value = !!document.fullscreenElement;
}
function togglePlayback() {
  store.playing = !store.playing;
}
async function toggleFull() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notice.value = '当前浏览器未允许全屏，可使用 F11';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.value = '';
    }, 4000);
  }
}
function keyboard(event: KeyboardEvent) {
  if (
    event.repeat ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (event.target as HTMLElement)?.matches('input,textarea,select,button') ||
    document.querySelector('.source-dialog, dialog[open]')
  )
    return;
  if (event.code === 'Space' && !props.vehicle) {
    event.preventDefault();
    togglePlayback();
  }
  if (event.code === 'KeyF') void toggleFull();
}
onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date();
  }, 1000);
  document.addEventListener('fullscreenchange', syncFull);
  window.addEventListener('keydown', keyboard);
});
onUnmounted(() => {
  clearInterval(timer);
  clearTimeout(noticeTimer);
  document.removeEventListener('fullscreenchange', syncFull);
  window.removeEventListener('keydown', keyboard);
});
</script>
<template>
  <header class="system-header glass-panel">
    <div class="header-brand">
      <CockpitBrand title="SENTINEL" subtitle="雷达视觉监控台" />
      <RouterLink class="vehicle-switch" :to="switchTo">
        <UiIcon name="car" :size="18" />{{ vehicle ? '返回总览' : '切换实体小车' }}
      </RouterLink>
    </div>
    <div class="system-health">
      <span :class="{ offline: ['error', 'disconnected'].includes(store.connection) || store.frame.live && store.frame.live.radar.state!=='streaming' && store.frame.live.camera.state!=='streaming' }"
        ><i class="live-dot" />{{ vehicle ? statusText : displayedStatus }}</span
      ><svg viewBox="0 0 140 20">
        <path
          d="M0 12h25l5-7 7 12 9-15 6 10h14l5-4 5 4h64"
          fill="none"
          stroke="currentColor"
          stroke-width="1.1"
        />
      </svg>
    </div>
    <div class="header-clock">
      <strong>{{ clock }}</strong
      ><span>{{ date }} <i>UTC+8</i></span>
    </div>
    <div v-if="!vehicle" class="header-performance">
      <span
        >FPS <b>{{ store.fps || '—' }}</b></span
      ><span
        >链路 <b>{{ store.frame.source === 'recording' ? '回放 10Hz' : store.connection === 'mock' ? 'LOCAL' : store.latency + 'ms' }}</b></span
      >
    </div>
    <div class="global-metrics">
      <div>
        <span>{{ radarOnly ? '雷达目标' : vehicle ? '融合目标' : '在线目标' }}</span
        ><strong><AnimatedMetric :value="vehicle ? (store.frame.riskField ? store.frame.targets.filter(target => target.fusion).length : null) : store.frame.targets.length" :pad="2" /></strong>
      </div>
      <div>
        <span>平均风险</span><strong><AnimatedMetric :value="store.averageRisk" :digits="2" /></strong>
      </div>
      <div>
        <span>高风险目标</span><strong><AnimatedMetric :value="store.alerts" /></strong>
      </div>
      <div>
        <span>最高风险</span><strong><AnimatedMetric :value="store.maximumRisk" :digits="2" /></strong>
      </div>
    </div>
    <div class="header-actions">
      <slot />
      <button
        v-if="!vehicle"
        class="icon-button"
        @click="togglePlayback"
        :aria-label="store.frame.source==='live' ? (store.playing ? '冻结实时显示' : '继续实时显示') : (store.playing ? '暂停回放' : '播放回放')"
        :title="store.playing ? '暂停 · Space' : (store.frame.source === 'recording' ? '播放 · Space' : '继续 · Space')"
      >
        <svg v-if="store.playing" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg
        ><svg v-else viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z" /></svg></button
      ><button
        class="icon-button"
        @click="toggleFull"
        :aria-label="full ? '退出全屏' : '进入全屏'"
        title="全屏 · F"
      >
        <svg viewBox="0 0 24 24"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg>
      </button>
    </div>
    <div v-if="notice" class="notice">{{ notice }}</div>
  </header>
</template>

<style scoped>
.header-brand { display: flex; flex: 1; align-items: center; flex-wrap: wrap; gap: 6px 16px; }
.header-brand .brand { flex: none; }
.vehicle-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-inline-size: 128px;
  min-block-size: 34px;
  padding: 6px 10px;
  border: 1px solid #77b5c1;
  border-radius: 6px;
  color: #e3f7f9;
  background: #164d58;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.vehicle-switch:hover, .vehicle-switch:focus-visible { background: #226673; }
@media (max-width: 520px) {
  .header-brand { flex-basis: 100%; }
}
</style>
