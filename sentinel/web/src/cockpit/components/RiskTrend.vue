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
defineProps<{ targetName: string }>();
const store = useSceneStore(),
  element = ref<HTMLDivElement | null>(null),
  period = ref(600);
const hasSamples = ref(false);
const recorded = computed(() => store.replayRiskHistory !== undefined);
const selectedTrack = computed(() => store.selected?.trackInstanceId ?? store.selectedId);
let chart: ECharts | undefined,
  observer: ResizeObserver | undefined,
  last = -Infinity;
const history = new Map<string, RiskTrendPoint[]>();
function record() {
  if(store.frame.timestamp < last){history.clear();last=-Infinity;}
  if (recorded.value) return;
  if (store.frame.timestamp - last < 1000 && store.frame.timestamp >= last) return;
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
  if (store.replayRiskHistory) return store.replayRiskHistory.get(selectedTrack.value) ?? [];
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
function render() {
  const end = recorded.value ? (store.frame.replay?.durationMs ?? 0) / 1000 : store.frame.timestamp / 1000;
  const data = points();
  hasSamples.value = data.some(([, value]) => value !== null);
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
        type: 'line',
        smooth: false,
        connectNulls: false,
        symbol: 'circle',
        symbolSize: (_: unknown, { dataIndex }: { dataIndex: number }) =>
          (data[dataIndex - 1]?.[1] == null && data[dataIndex + 1]?.[1] == null ? 7 : 0),
        itemStyle: { color: '#009f9b' },
        data,
        lineStyle: { width: 2.6, color: '#009f9b' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#00baa777' },
              { offset: 1, color: '#43cabb00' },
            ],
          },
        },
      },
    ],
  });
}
watch(() => store.frame, record);
watch(() => [selectedTrack.value, period.value, store.replayRiskHistory], render);
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
      <div v-if="!recorded" class="periods">
        <button
          v-for="p in [60, 600, 1800]"
          :key="p"
          :class="{ active: period === p }"
          @click="period = p"
        >
          {{ p / 60 }}m
        </button>
      </div>
    </div>
    <div class="trend-chart-wrap">
      <div ref="element" class="trend-chart" aria-label="所选目标风险历史趋势" />
      <p v-if="!hasSamples" class="trend-empty">{{ recorded ? '该目标在本段录像没有有效场值' : '暂无该目标的场值记录' }}</p>
    </div>
    <div class="trend-foot">
      <i class="live-dot" />{{ recorded ? '录像时间轴' : store.connection === 'mock' ? '模拟历史' : '本次会话历史'
      }}<span>目标 {{ targetName }}</span>
    </div>
  </section>
</template>

