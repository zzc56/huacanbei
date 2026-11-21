<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSceneStore } from '../stores/scene';
import AnimatedMetric from './AnimatedMetric.vue';
import CockpitBrand from './CockpitBrand.vue';
const props=defineProps<{vehicle?:boolean; statusText?:string; refreshHz?:number; requestMs?:number|null}>();
const emit=defineEmits<{toggle:[]}>();
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
  return radar&&camera?'雷达 / 摄像头在线':camera?'摄像头在线 · 雷达待连接':radar?'实物雷达在线':live.radar.state==='stale'?'雷达数据超时':'等待设备连接';
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
function syncFull() {
  full.value = !!document.fullscreenElement;
}
function togglePlayback() {
  if(props.vehicle)emit('toggle');
  else store.playing=!store.playing;
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
    document.querySelector('.source-dialog')
  )
    return;
  if (event.code === 'Space') {
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
    <CockpitBrand :title="vehicle?'车路协同监控平台':'多模态融合监控中枢'" :subtitle="vehicle?'SENTINEL / VEHICLE–ROAD COOPERATION':'MULTI-MODAL FUSION MONITORING CENTER'" />
    <div class="system-health">
      <span :class="{ offline: ['error', 'disconnected'].includes(store.connection) || store.frame.live && store.frame.live.radar.state!=='streaming' && store.frame.live.camera.state!=='streaming' }"
        ><i class="live-dot" />{{ vehicle ? statusText : store.playing ? status : store.frame.source==='live' ? '显示已冻结 · 采集继续' : '回放已暂停' }}</span
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
    <div class="header-performance">
      <span
        >{{ vehicle?'刷新':'FPS' }} <b>{{ vehicle ? (refreshHz??0)+' Hz' : store.fps || '—' }}</b></span
      ><span
        >链路 <b>{{ vehicle ? (requestMs==null?'—':requestMs+'ms') : store.frame.source === 'recording' ? '回放 10Hz' : store.connection === 'mock' ? 'LOCAL' : store.latency + 'ms' }}</b></span
      >
    </div>
    <div class="global-metrics">
      <div>
        <span>{{ vehicle?'融合目标':'在线目标' }}</span
        ><strong><AnimatedMetric :value="vehicle ? (store.frame.riskField ? store.frame.targets.filter(t=>t.fusion).length : null) : store.frame.targets.length" :pad="2" /></strong>
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
      <button
        class="icon-button"
        @click="togglePlayback"
        :aria-label="store.frame.source==='live'||vehicle&&!store.frame.vehicle?.demo ? (store.playing ? '冻结实时显示' : '继续实时显示') : (store.playing ? '暂停回放' : '继续回放')"
        :title="store.playing ? '暂停 · Space' : '继续 · Space'"
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
