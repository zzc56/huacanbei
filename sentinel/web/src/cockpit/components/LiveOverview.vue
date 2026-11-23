<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { gsap } from 'gsap';
import { useSceneStore } from '../stores/scene';
import type { Target } from '../types';
import type { ViewMode } from '../renderers/lightScene';
import SceneViewport from './SceneViewport.vue';
import SpotlightReadout from './SpotlightReadout.vue';

defineProps<{ targets: Target[]; time: number }>();
defineEmits<{ open: [mode: ViewMode] }>();

const store = useSceneStore();
const stage = ref<HTMLElement>();
const view = ref<'radar' | 'risk'>('radar');
const sensors = [{ mode: 'radar', label: '雷达探测' }, { mode: 'risk', label: '风险场' }] as const;
const radarOnline = computed(() => store.frame.live?.radar.state === 'streaming');
const radarCount = computed(() => store.frame.targets.filter(target => target.radar).length);
const cameraCount = computed(() => store.frame.targets.filter(target => target.camera).length);
const selectedRisk = computed(() => store.selected?.risk?.value);
let entrance: gsap.core.Tween | undefined;
onMounted(() => {
  if (stage.value && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    entrance = gsap.from(stage.value, { opacity: 0, y: 12, duration: .55, clearProps: 'opacity,transform', ease: 'power3.out' });
  }
});
onBeforeUnmount(() => entrance?.kill());
</script>

<template>
  <section ref="stage" class="live-overview" aria-labelledby="live-overview-title">
    <header>
      <h2 id="live-overview-title">实时观测</h2>
      <span class="live-state">{{ store.playing ? '摄像头在线' : '显示已暂停' }}</span>
    </header>
    <div class="live-layout">
      <div class="live-camera">
        <div class="live-video"><SceneViewport mode="camera" :targets="targets" :time="time" compact /></div>
        <div class="live-camera-bar">
          <span>视觉目标 <b>{{ cameraCount }}</b></span>
          <span>帧序号 <b>{{ store.frame.cameraFrame?.sequence ?? '—' }}</b></span>
          <span>画面延迟 <b>{{ store.cameraLatencyMs ?? '—' }} ms</b></span>
          <button type="button" @click="$emit('open', 'camera')">展开画面</button>
        </div>
      </div>
      <aside class="live-instruments" aria-label="实时观测数据">
        <div class="live-switch" role="group" aria-label="切换侧边视图">
          <button v-for="sensor in sensors" :key="sensor.mode" type="button" :aria-pressed="view === sensor.mode"
            @click="view = sensor.mode">{{ sensor.label }}</button>
        </div>
        <div class="live-sensor">
          <SceneViewport :key="view" :mode="view" :targets="targets" :time="time" compact :minimap="view === 'radar'" />
        </div>
        <div class="sensor-bar">
          <span v-if="view === 'radar'">{{ radarOnline ? radarCount + ' 个雷达目标' : '等待雷达数据' }}</span>
          <span v-else>{{ store.frame.riskField ? '相对风险估计' : '等待风险场数据' }}</span>
          <button type="button" @click="$emit('open', view)">展开</button>
        </div>
        <SpotlightReadout label="选中目标风险" :value="selectedRisk?.toFixed(2) ?? '—'"
          :elevated="selectedRisk !== undefined && selectedRisk >= 0.4" />
        <p v-if="store.frame.live" class="sensor-note">{{ store.frame.live.fusion.message }}</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.live-overview {
  margin: 12px 0 5px; padding: clamp(12px, 2vw, 26px); background: #edf4f7; color: #112533;
  border: 1px solid #b6cad6; border-radius: 12px; font-variant-numeric: tabular-nums;
}
.live-overview header, .live-camera-bar, .sensor-bar { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
.live-overview header { margin-bottom: 15px; }
.live-overview h2 { margin: 0; font-size: clamp(24px, 3.4vw, 36px); line-height: 1.2; }
.live-state { color: #216c82; font-size: 13px; }
.live-layout { display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(245px, 1fr); gap: clamp(16px, 2.5vw, 36px); }
.live-video { position: relative; aspect-ratio: 16 / 9; min-height: 160px; border-radius: 7px; overflow: hidden; display: flex; }
.live-camera-bar { margin-top: 10px; color: #405d70; font-size: 12px; }
.live-camera-bar b { color: #112533; }
.live-instruments { min-width: 0; border-radius: 7px; background: #0d1d2b; color: #dceaf4; padding: 13px; }
.live-switch { display: flex; gap: 5px; margin-bottom: 8px; }
.live-instruments button, .live-camera-bar button { padding: 5px 8px; border: 1px solid currentColor; border-radius: 4px; font-size: 12px; cursor: pointer; }
.live-switch button[aria-pressed='true'] { background: #a9def2; color: #132638; }
.live-sensor { aspect-ratio: 1.62; display: flex; position: relative; overflow: hidden; border-radius: 4px; }
.sensor-bar { margin: 8px 0; color: #bccbd7; font-size: 12px; }
.sensor-note { margin: 7px 0 0; font-size: 11px; color: #adbfcd; }
.live-overview button:active { transform: scale(.96); }
@media (max-width: 760px) { .live-layout { grid-template-columns: 1fr; } }
</style>
