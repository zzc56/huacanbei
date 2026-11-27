<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { use, init, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useSceneStore } from '../stores/scene';
import { mockFrame } from '../services/stream';
import type { RiskTrendPoint } from '../types';
use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const props = defineProps<{ targetName: string; bundledReplay?: boolean }>();
const store = useSceneStore(),
  element = ref<HTMLDivElement | null>(null),
  period = ref(store.frame.vehicle ? 10 : 600);
const hasSamples = ref(false);
const recorded = computed(() => store.replayRiskHistory !== undefined);
const selectedTrack = computed(() => store.selected?.trackInstanceId ?? store.selectedId);
const flourishUrl = 'https://public.flourish.studio/visualisation/31017270/embed';
const flourishAvailable = computed(() => recorded.value && props.bundledReplay &&
  store.selectedId === 'radar:130');
const showNative = ref(true);
const embedded = computed(() => flourishAvailable.value && !showNative.value);
watch(flourishAvailable, () => { showNative.value = true; });
const replaySeconds = computed(() => (store.frame.replay?.positionMs ?? 0) / 1000);
const replayDuration = computed(() => (store.frame.replay?.durationMs ?? 0) / 1000);
const currentRisk = computed(() => recorded.value ? store.selectedMeasurement?.risk?.value : undefined);
const replayPoints = computed(() => store.replayRiskHistory?.get(selectedTrack.value) ?? []);
const revealedCount = computed(() => {
  const series = replayPoints.value;
  let start = 0;
  let end = series.length;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    if (series[mid][0] <= replaySeconds.value) start = mid + 1;
    else end = mid;
  }
  return start;
});
const revealedPoints = computed(() => replayPoints.value.slice(0, revealedCount.value));
const hasRevealedSamples = computed(() => revealedPoints.value.some(([, value]) => value !== null));
const replayColor = '#245cc4';
let chart: ECharts | undefined,
  observer: ResizeObserver | undefined,
  last = -Infinity;
let renderedReplayPoints: RiskTrendPoint[] | undefined;
const history = new Map<string, RiskTrendPoint[]>();
function record() {
  if(store.frame.timestamp < last){history.clear();last=-Infinity;}
  if (recorded.value) return;
  if (store.frame.timestamp - last < (store.frame.vehicle ? 100 : 1000) && store.frame.timestamp >= last) return;
  last = store.frame.timestamp;
  for(const [id,series] of history)if(!store.knownRiskTargets.some(t=>(t.trackInstanceId ?? t.id)===id)&&series.at(-1)?.[1]!==null)series.push([last/1000,null]);
  for(const [id,series] of history) if(series.length && last/1000-series[series.length-1][0]>1800)history.delete(id);
  for (const t of store.knownRiskTargets) {
    if (!t.risk) continue;
    const key = t.trackInstanceId ?? t.id;
    const series = history.get(key) || [];
    series.push([last / 1000, t.risk.value]);
    if (series.length > 1800) series.shift();
    history.set(key, series);
  }
  render();
}
function points(): RiskTrendPoint[] {
  const end = store.frame.timestamp / 1000,
    start = end - period.value;
  // 仅模拟模式可回算历史；真实流仅展示本次收到的数据。
  if (store.connection === 'mock')
    return Array.from({ length: 100 }, (_, i) => {
      const t = start + (i * period.value) / 99;
      return [t, mockFrame(t).targets.find((x) => x.id === store.selectedId)?.risk?.value ?? 0];
    });
  return (history.get(selectedTrack.value) || []).filter(([t]) => t >= start);
}
function updateReplayCursor() {
  if (!recorded.value || !chart) return;
  const x = Math.min(replayDuration.value, Math.max(0, replaySeconds.value));
  const risk = currentRisk.value;
  const visible = revealedPoints.value;
  chart.setOption({
    series: [
      ...(visible === renderedReplayPoints ? [] : [{ id: 'target-risk', data: visible }]),
      { id: 'replay-cursor', data: [[x, 0], [x, 1]] },
      { id: 'replay-point', data: risk === undefined || !hasRevealedSamples.value ? [] : [[x, risk]] },
    ],
  });
  renderedReplayPoints = visible;
}
function render() {
  const end = recorded.value ? replayDuration.value : store.frame.timestamp / 1000;
  const data = recorded.value ? revealedPoints.value : points();
  renderedReplayPoints = recorded.value ? data : undefined;
  const color = recorded.value ? replayColor : '#009f9b';
  hasSamples.value = recorded.value ? replayPoints.value.length > 0 : data.some(([, value]) => value !== null);
  chart?.setOption({
    animation: false,
    grid: { top: 22, left: 36, right: 12, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffffed',
      borderColor: '#dfebe8',
      textStyle: { color: '#183d45', fontSize: 12 },
      valueFormatter: (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—',
    },
    xAxis: {
      type: 'value',
      min: recorded.value ? 0 : end - period.value,
      max: end,
      splitNumber: 4,
      axisLine: { lineStyle: { color: '#d2e3df' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#3c6a88',
        fontSize: 11,
        formatter: (v: number) => {
          if (recorded.value) return `${v} s`;
          if (period.value < 60) return Math.round(v - end) + ' s';
          const minutes = Math.round((v - end) / 60);
          return minutes === 0 ? '现在' : minutes + ' min';
        },
      },
      splitLine: { show: true, lineStyle: { color: '#94bfd53d' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      interval: 0.25,
      axisLabel: {
        color: '#3c6a88',
        fontSize: 11,
        formatter: (v: number) => (v === 0.25 || v === 0.75 ? '' : v.toFixed(1)),
      },
      splitLine: { lineStyle: { color: '#94bfd55c' } },
      axisLine: { show: false },
    },
    series: [
      {
        id: 'target-risk',
        type: 'line',
        smooth: false,
        connectNulls: false,
        symbol: 'circle',
        symbolSize: (_: unknown, { dataIndex }: { dataIndex: number }) => {
          const series = recorded.value ? revealedPoints.value : data;
          return series[dataIndex - 1]?.[1] == null && series[dataIndex + 1]?.[1] == null ? 7 : 0;
        },
        itemStyle: { color },
        data,
        lineStyle: { width: 2.6, color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: recorded.value ? '#245cc42f' : '#00baa777' },
              { offset: 1, color: '#ffffff00' },
            ],
          },
        },
      },
      ...(recorded.value ? [
        {
          id: 'replay-cursor', type: 'line', data: [], silent: true, symbol: 'none',
          tooltip: { show: false }, z: 4,
          lineStyle: { color: '#6784bd', type: 'dashed', width: 1 },
        },
        {
          id: 'replay-point', type: 'line', data: [], silent: true, symbol: 'circle', symbolSize: 8,
          tooltip: { show: false }, z: 5,
          itemStyle: { color: replayColor, borderColor: '#fff', borderWidth: 1.5 },
        },
      ] : []),
    ],
  }, { replaceMerge: ['series'] });
  updateReplayCursor();
}
watch(() => store.frame, record);
watch([selectedTrack, period, () => store.replayRiskHistory, replayDuration], render);
watch([replaySeconds, currentRisk, revealedPoints], updateReplayCursor);
onMounted(() => {
  chart = init(element.value!);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(element.value!);
  record();
  render();
});
onUnmounted(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>
<template>
  <section class="risk-trend">
    <div class="section-heading">
      <h3>风险趋势</h3>
      <button v-if="flourishAvailable" class="trend-source-button" type="button"
        @click="showNative = !showNative">{{ embedded ? '录像同步版' : 'Flourish 原图' }}</button>
      <div v-if="!recorded" class="periods">
        <button
          v-for="p in store.frame.vehicle ? [10, 60, 600] : [60, 600, 1800]"
          :key="p"
          :class="{ active: period === p }"
          @click="period = p"
        >
          {{ p < 60 ? p + 's' : p / 60 + 'm' }}
        </button>
      </div>
    </div>
    <iframe v-if="embedded" class="flourish-trend" :src="flourishUrl" loading="lazy"
      title="Flourish 历史风险趋势 · 车辆 130" referrerpolicy="no-referrer" />
    <div v-show="!embedded" class="trend-chart-wrap">
      <div ref="element" class="trend-chart" aria-label="所选目标风险历史趋势" />
      <p v-if="!hasSamples" class="trend-empty">{{ recorded ? '该目标在本段录像没有有效场值' : '暂无该目标的场值记录' }}</p>
      <p v-else-if="recorded && !hasRevealedSamples" class="trend-empty">尚未播到该目标的有效风险记录</p>
    </div>
    <div class="trend-foot">
      <i class="live-dot" />
      <template v-if="recorded && !embedded">
        <span class="replay-reading">{{ replaySeconds.toFixed(1) }} s · {{ currentRisk?.toFixed(2) ?? '暂无读数' }}</span>
      </template>
      <template v-else>{{ embedded ? 'Flourish · 独立回放' : store.connection === 'mock' ? '模拟历史' : '本次会话历史' }}</template>
      <span>目标 {{ targetName }}</span>
    </div>
  </section>
</template>

<style scoped>
.flourish-trend {
  display: block;
  width: 100%;
  height: 300px;
  flex: 0 0 300px;
  margin-top: 10px;
  border: 1px solid #d2e3df;
  border-radius: 6px;
  background: white;
}
.trend-source-button {
  padding: 4px 7px;
  font-size: 12px;
  color: #136a70;
  border: 1px solid #b9d9dc;
  border-radius: 5px;
}
.trend-source-button:hover { background: #e1f2f3; }
.trend-foot .replay-reading { margin: 0; font-variant-numeric: tabular-nums; }
</style>

