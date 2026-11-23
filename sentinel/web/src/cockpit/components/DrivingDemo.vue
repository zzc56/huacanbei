<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { gsap } from 'gsap';
import frames from '../data/demoDriveFrames.json';
import SpotlightReadout from './SpotlightReadout.vue';

const asset = import.meta.env.BASE_URL + 'demo-drive/';
const video = ref<HTMLVideoElement>();
const deck = ref<HTMLElement>();
const riskMarker = ref<HTMLElement>();
const videoUrl = ref('');
const time = ref(0);
const duration = ref(0);
const playing = ref(false);
const failed = ref(false);
const target = ref<'lead' | 'side' | 'bikeRisk'>('lead');
const request = new AbortController();
const latestFirst = frames.slice().reverse();
const current = computed(() => latestFirst.find(frame => frame.time <= time.value) ?? frames[0]);
const total = computed(() => current.value.car + current.value.bike);
const events = [
  { time: 1.5, title: '左侧来车' },
  { time: 4.5, title: '跟车间距缩短' },
  { time: 8, title: '驶近路口' },
];
const levels = [
  { key: 'low', label: '低', color: '#60e6df' },
  { key: 'medium', label: '中', color: '#ffc478' },
  { key: 'high', label: '高', color: '#ff857a' },
] as const;
const distribution = computed(() => levels.map(level => ({ ...level, count: current.value[level.key] })));
const ranking = computed(() => [
  { label: 'car', count: current.value.car },
  { label: 'bike', count: current.value.bike },
].sort((a, b) => b.count - a.count));
const rankLimit = Math.max(...frames.map(frame => Math.max(frame.car, frame.bike)));
const wantedDuration = computed(() => duration.value || 10);
const progress = computed(() => Math.min(100, 100 * time.value / wantedDuration.value));
const xAt = (t: number) => 30 + 302 * t / wantedDuration.value;
const yAt = (risk: number) => 116 - 102 * risk;
const trend = computed(() => {
  let penDown = false;
  return frames.map(frame => {
    const score = frame[target.value];
    if (score === null) { penDown = false; return ''; }
    const command = penDown ? 'L' : 'M';
    penDown = true;
    return `${command}${xAt(frame.time)},${yAt(score)}`;
  }).join(' ');
});
const selectedRisk = computed(() => {
  const sample = current.value;
  const score = sample[target.value];
  if (score === null) return null;
  const next = frames.find(frame => frame.time > time.value);
  const nextScore = next?.[target.value];
  if (!next || nextScore === null || nextScore === undefined) return score;
  return score + (nextScore - score) * (time.value - sample.time) / (next.time - sample.time);
});
const peak = computed(() => frames.reduce((best, frame) =>
  (frame[target.value] ?? -1) > (best[target.value] ?? -1) ? frame : best,
));
const stamp = (value: number) => value.toFixed(1).padStart(4, '0');

let animationFrame = 0;
function updateTime() {
  if (video.value) time.value = video.value.currentTime;
}
function startMotion() {
  playing.value = true;
  cancelAnimationFrame(animationFrame);
  const tick = () => {
    updateTime();
    animationFrame = requestAnimationFrame(tick);
  };
  tick();
}
function stopMotion() {
  playing.value = false;
  cancelAnimationFrame(animationFrame);
  updateTime();
}
function seek(to: number) {
  if (!video.value || !duration.value) return;
  video.value.currentTime = Math.min(duration.value, Math.max(0, to));
  updateTime();
}
function inspect(to: number) {
  video.value?.pause();
  seek(to);
}
async function toggle() {
  const player = video.value;
  if (!player || !duration.value) return;
  if (!player.paused) player.pause();
  else {
    if (player.ended) seek(0);
    await player.play().catch(() => { playing.value = false; });
  }
}
function loaded() {
  const player = video.value;
  if (!player || !Number.isFinite(player.duration)) return;
  duration.value = player.duration;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void player.play().catch(() => { playing.value = false; });
  }
}
onMounted(async () => {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && deck.value) {
    gsap.from(deck.value, { opacity: 0, y: 12, duration: .55, clearProps: 'opacity,transform', ease: 'power3.out' });
  }
  try {
    // A local Blob supports precise seeking even when the static server serves the whole file.
    const response = await fetch(asset + 'drive.mp4', { signal: request.signal });
    if (!response.ok) throw new Error('Video unavailable');
    const blob = await response.blob();
    if (!request.signal.aborted) videoUrl.value = URL.createObjectURL(blob);
  } catch {
    if (!request.signal.aborted) failed.value = true;
  }
});
onUnmounted(() => {
  gsap.killTweensOf([deck.value, riskMarker.value].filter(Boolean));
  cancelAnimationFrame(animationFrame);
  request.abort();
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
});
watch(() => current.value.high, (high, previous) => {
  if (!riskMarker.value || high <= previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  gsap.fromTo(riskMarker.value, { opacity: .35, x: -5 }, { opacity: 1, x: 0, duration: .4, ease: 'power2.out', overwrite: true });
}, { flush: 'post' });
</script>

<template>
  <section ref="deck" class="drive-demo" aria-labelledby="drive-demo-title">
    <header class="demo-heading">
      <h2 id="drive-demo-title">驾驶仿真</h2>
      <span class="demo-status"><i aria-hidden="true" />仿真演示<span> / 等待摄像头</span></span>
    </header>

    <div class="demo-layout">
      <div class="film">
        <div class="film-view">
          <video ref="video" :src="videoUrl || undefined" :poster="asset + 'poster.jpg'"
            aria-label="雨夜城市道路仿真" muted playsinline preload="auto"
            @loadedmetadata="loaded" @timeupdate="updateTime" @seeked="updateTime"
            @play="startMotion" @pause="stopMotion" @ended="stopMotion" @error="failed = true" />
          <p v-if="failed" class="film-error" role="status">仿真视频加载失败</p>
        </div>
      </div>
      <section class="trend-deck" aria-labelledby="demo-trend">
        <div class="instrument-heading"><h3 id="demo-trend">选中目标风险趋势</h3></div>
        <div ref="riskMarker">
          <SpotlightReadout label="当前风险" :value="selectedRisk?.toFixed(2) ?? '已出画'"
            :elevated="selectedRisk !== null && selectedRisk >= 0.36" />
        </div>
        <div class="target-choice">
          <select v-model="target" aria-label="选择仿真目标">
            <option value="lead">CAR 01 · 银色前车</option>
            <option value="side">CAR 02 · 左侧蓝车</option>
            <option value="bikeRisk">BIKE 01 · 右侧两轮车</option>
          </select>
        </div>
        <svg class="trend" viewBox="0 0 348 140" aria-hidden="true">
          <g v-for="value in [0, 0.25, 0.5, 0.75, 1]" :key="value">
            <line x1="30" x2="332" :y1="yAt(value)" :y2="yAt(value)" class="grid-line" />
            <text v-if="value === 0 || value === 0.5 || value === 1" x="24" :y="yAt(value) + 4" class="scale-y">{{ value.toFixed(1) }}</text>
          </g>
          <text v-for="second in [0, 2, 4, 6, 8, 10]" :key="second" :x="xAt(second)" y="133" class="scale-x">{{ second }}s</text>
          <defs>
            <clipPath id="drive-demo-played"><rect x="0" y="0" :width="xAt(time)" height="140" /></clipPath>
          </defs>
          <path :d="trend" class="trace future" />
          <path :d="trend" class="trace" clip-path="url(#drive-demo-played)" />
          <line :x1="xAt(time)" :x2="xAt(time)" y1="9" y2="116" class="playhead" />
          <circle v-if="selectedRisk !== null" :cx="xAt(time)" :cy="yAt(selectedRisk)" r="4.5" class="trace-dot" />
        </svg>
        <button type="button" class="peak-link" :disabled="!duration" @click="inspect(peak.time)">
          跳到峰值 <b>{{ stamp(peak.time) }} s</b>
        </button>
        <p class="risk-note">根据画面中的相对接近程度估算</p>
      </section>
    </div>

    <div class="data-deck">
      <div class="film-controls">
        <div class="transport">
          <button type="button" :disabled="!duration" @click="toggle">
            {{ playing ? '暂停' : time >= duration && duration ? '重播' : '播放' }}
          </button>
          <input aria-label="仿真视频进度" type="range" min="0" :max="wantedDuration"
            step="0.01" :value="time" :disabled="!duration" :style="{ '--progress': progress + '%' }"
            @input="seek(Number(($event.target as HTMLInputElement).value))" />
          <output>{{ stamp(time) }} <span>/ {{ stamp(wantedDuration) }} s</span></output>
        </div>
        <div class="film-events" aria-label="视频关键时刻">
          <button v-for="event in events" :key="event.time" type="button" :disabled="!duration"
            :class="{ current: time >= event.time && time - event.time < 1 }" @click="inspect(event.time)">
            <img :src="asset + 'event-' + event.time.toFixed(1) + '.jpg'" alt="" />
            <span><b>{{ stamp(event.time) }} s</b> {{ event.title }}</span>
          </button>
        </div>
      </div>

      <aside class="instrument-strip" aria-label="驾驶仿真统计">
        <section aria-labelledby="demo-distribution">
          <div class="instrument-heading">
            <h3 id="demo-distribution">风险等级分布</h3>
            <span>当前目标 <b>{{ total }}</b></span>
          </div>
          <div class="risk-spectrum">
            <div class="risk-names">
              <span v-for="level in distribution" :key="level.key" :style="{ color: level.color }">{{ level.label }}</span>
            </div>
            <div class="risk-history" aria-hidden="true">
              <div v-for="level in distribution" :key="level.key" class="risk-history-row" :style="{ '--band': level.color }">
                <i v-for="frame in frames" :key="frame.time" :class="{ seen: frame.time <= time }"
                  :style="{ '--intensity': frame[level.key] ? 0.32 + 0.68 * frame[level.key] / (frame.car + frame.bike) : 0 }" />
              </div>
              <span class="risk-cursor" :style="{ left: progress + '%' }" />
            </div>
            <div class="risk-counts" aria-label="当前风险分布">
              <b v-for="level in distribution" :key="level.key" :style="{ color: level.color }"
                :aria-label="level.label + '风险 ' + level.count">
                <span :key="level.count">{{ level.count }}</span>
              </b>
            </div>
          </div>
        </section>

        <section aria-labelledby="demo-ranking">
          <div class="instrument-heading"><h3 id="demo-ranking">车辆类型目标排行</h3></div>
          <ul class="rank">
            <li v-for="row in ranking" :key="row.label">
              <span>{{ row.label }}</span>
              <div class="rank-line" aria-hidden="true"><i :style="{ width: 100 * row.count / rankLimit + '%' }" /></div>
              <b :key="row.count">{{ String(row.count).padStart(2, '0') }}</b>
            </li>
          </ul>
        </section>

      </aside>
    </div>
  </section>
</template>

<style scoped>
.drive-demo {
  --ink: #112533;
  --muted: #4a6475;
  --rule: #adc2cf;
  --teal: #216c82;
  --amber: #ffc478;
  min-width: 0;
  margin: 12px 0 5px;
  padding: clamp(12px, 2vw, 26px);
  color: var(--ink);
  background: #edf4f7;
  border: 1px solid #b6cad6;
  border-radius: 12px;
  font-variant-numeric: tabular-nums;
  color-scheme: light;
}
.demo-heading, .transport, .target-choice, .instrument-heading { display: flex; align-items: center; }
.demo-heading { justify-content: space-between; gap: 8px; margin-bottom: 15px; }
.demo-heading h2 { margin: 0; font-size: clamp(24px, 3.4vw, 36px); font-weight: 700; letter-spacing: -.025em; }
.demo-status { color: var(--ink); font-size: 12px; white-space: nowrap; }
.demo-status > span { color: var(--muted); }
.demo-status i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--teal); margin-right: 7px; vertical-align: 2px; }
.demo-layout { display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(245px, 1fr); gap: clamp(16px, 2.5vw, 36px); align-items: stretch; }
.film { min-width: 0; }
.film-view {
  position: relative; aspect-ratio: 1248 / 704; overflow: hidden; border-radius: 7px;
  background: #0b1624; outline: 1px solid #96b8ce35;
}
.film-view video { display: block; width: 100%; height: 100%; object-fit: contain; }
.film-error { position: absolute; inset: auto 8px 8px; padding: 8px; background: #122531; color: white; }
.transport { gap: clamp(8px, 1.2vw, 14px); padding-block: 12px; }
.transport button {
  min-width: 60px; min-height: 34px; border-radius: 5px; border: 1px solid #72ebe2a0;
  background: #216c82; color: #ffffff; font-size: 13px; font-weight: 700; cursor: pointer;
}
.transport button:active { transform: scale(.96); }
.transport input {
  flex: 1; min-width: 0; height: 18px; appearance: none; background: transparent; cursor: pointer;
}
.transport input::-webkit-slider-runnable-track {
  height: 3px; border-radius: 2px;
  background: linear-gradient(to right, var(--teal) var(--progress), #c6d8e1 var(--progress));
}
.transport input::-webkit-slider-thumb {
  appearance: none; width: 11px; height: 11px; margin-top: -4px; border-radius: 50%;
  background: var(--teal); box-shadow: 0 0 0 3px #216c8226;
}
.transport input::-moz-range-track { height: 3px; background: #466278; }
.transport input::-moz-range-progress { height: 3px; background: var(--teal); }
.transport input::-moz-range-thumb { width: 11px; height: 11px; border: 0; background: var(--teal); }
.transport output { flex: none; font-size: 14px; font-weight: 700; }
.transport output span { font-weight: 400; color: var(--muted); }
.film-events { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.film-events button {
  display: grid; justify-items: start; min-width: 0; gap: 3px; padding: 8px 4px 3px;
  border-top: 2px solid #6680997d; color: var(--muted); font-size: 12px; text-align: left; cursor: pointer;
  transition: border-color 160ms ease, color 160ms ease;
}
.film-events button b { color: var(--ink); font-size: 12px; font-weight: 600; }
.film-events button:hover, .film-events button.current { color: var(--ink); border-color: var(--teal); }
.film-events button.current b { color: var(--teal); }
.instrument-strip { min-width: 0; padding-left: clamp(11px, 2vw, 24px); border-left: 1px solid var(--rule); }
.instrument-strip section { padding: 10px 0; }
.instrument-strip section:first-child { padding-top: 0; }
.instrument-strip section:last-child { padding-bottom: 0; }
.instrument-strip section + section { border-top: 1px solid var(--rule); }
.instrument-heading { justify-content: space-between; gap: 6px; margin-bottom: 6px; }
.instrument-heading h3 { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.5; }
.instrument-heading > span { color: var(--muted); font-size: 11px; white-space: nowrap; }
.instrument-heading > span b { color: var(--ink); margin-left: 3px; font-size: 15px; }
.risk-spectrum { display: grid; grid-template-columns: 16px minmax(0, 1fr) 14px; gap: 7px; }
.risk-names, .risk-counts, .risk-history { display: grid; grid-template-rows: repeat(3, 15px); gap: 3px; }
.risk-names, .risk-counts { align-items: center; font-size: 12px; }
.risk-counts { justify-items: end; }
.risk-counts span, .rank li b { display: inline-block; animation: readout 230ms ease-out; }
.risk-history { position: relative; }
.risk-history-row { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; }
.risk-history-row i {
  border-radius: 1px;
  background: color-mix(in srgb, var(--band) calc(var(--intensity) * 100%), #31465c);
  opacity: .22; transition: opacity 170ms ease-out;
}
.risk-history-row i.seen { opacity: 1; }
.risk-cursor {
  position: absolute; top: -3px; bottom: -3px; width: 1px; pointer-events: none;
  background: #e2faff; box-shadow: 0 0 7px #a5efffaa; transform: translateX(-50%);
}
.rank { list-style: none; padding: 0; margin: 0; }
.rank li { display: grid; grid-template-columns: 38px 1fr 24px; gap: 10px; align-items: center; min-height: 23px; font-size: 13px; }
.rank li b { justify-self: end; color: var(--teal); }
.rank-line { position: relative; height: 5px; background: #344b61; border-radius: 2px; }
.rank-line i {
  display: block; position: relative; height: 100%; border-radius: inherit;
  background: linear-gradient(90deg, #4087a8, #76eee2); transition: width 380ms cubic-bezier(.18,.72,.31,1);
}
.rank-line i::after {
  content: ''; position: absolute; right: 0; top: -2px; width: 1px; height: 9px;
  background: #bafcf6; box-shadow: 0 0 6px #73fff8;
}
.target-choice { justify-content: space-between; gap: 8px; }
.target-choice { margin-top: 12px; }
.target-choice select {
  max-width: 78%; padding: 4px 7px; font-size: 12px; border-radius: 4px;
  border: 1px solid #566d84; color: var(--ink); background: #1b3146;
}
.target-choice strong { color: var(--teal); font-size: 19px; }
.target-choice strong.elevated { color: var(--amber); }
.trend { display: block; width: 100%; max-height: 180px; margin-top: 3px; }
.grid-line { stroke: #415970; stroke-width: 1; }
.scale-y, .scale-x { fill: var(--muted); font-size: 10px; }
.scale-y { text-anchor: end; }
.scale-x { text-anchor: middle; }
.trace { fill: none; stroke: #8fd5f1; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.future { stroke: #688298; stroke-dasharray: 3 5; stroke-width: 1.4; }
.playhead { stroke: var(--teal); stroke-opacity: .65; stroke-dasharray: 2 3; }
.trace-dot { fill: var(--amber); stroke: #ffe2af; stroke-width: 1.5; }
.peak-link { padding: 4px 0; color: var(--muted); font-size: 12px; text-align: left; cursor: pointer; }
.peak-link b { color: var(--amber); }
.peak-link:hover { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.risk-note { margin: 1px 0 0; color: var(--muted); font-size: 11px; }
.drive-demo :is(button,input,select):focus-visible { outline: 2px solid var(--teal); outline-offset: 3px; }
.drive-demo :is(button,input):disabled { opacity: .55; cursor: default; }
@keyframes readout { from { opacity: .45; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
.trend-deck {
  --ink: #eff7fd;
  --muted: #abbdcb;
  --teal: #9bddf4;
  display: flex; flex-direction: column; align-items: stretch;
  justify-content: center; min-width: 0; color: var(--ink);
  padding: 16px; border-radius: 7px; background: #0d1d2b;
}
.trend-deck .instrument-heading { margin-bottom: 12px; }
.data-deck {
  display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(245px, 1fr);
  gap: clamp(16px, 2.5vw, 36px); margin-top: 12px;
}
.film-events button { position: relative; overflow: hidden; padding: 0; border: 1px solid #9ab7c7; border-radius: 5px; background: #122434; color: #f5fbff; }
.film-events button img { display: block; width: 100%; height: clamp(56px, 6.1vw, 106px); object-fit: cover; transition: transform .3s ease; }
.film-events button span {
  position: absolute; inset: auto 0 0; padding: 12px 6px 5px;
  background: linear-gradient(transparent, #081726 65%); color: inherit; font-size: 12px;
}
.film-events button b { color: #d0edf8; }
.film-events button:hover img { transform: scale(1.04); }
.film-events button.current, .film-events button:hover { border-color: #216c82; color: #fff; }
.film-events button.current b { color: #a8e7ff; }
.film-events button:active { transform: scale(.98); }
.instrument-strip { padding: 0; border: 0; }
.risk-spectrum { padding: 8px; border-radius: 4px; background: #192d3e; }
.risk-counts, .risk-names { font-weight: 700; }
.rank-line { background: #c2d6df; }
.rank-line i { background: #327c98; }
.rank-line i::after { box-shadow: none; background: #15536a; }
@media (max-width: 760px) {
  .data-deck { grid-template-columns: 1fr; }
  .demo-layout { grid-template-columns: 1fr; }
  .film-events button span { position: static; background: #112535; width: 100%; padding: 4px 5px; }
  .film-events button b { display: block; }
  .instrument-strip { padding-left: 0; padding-top: 14px; border-top: 1px solid var(--rule); border-left: 0; }
  .trend { max-height: 145px; }
}
@media (prefers-reduced-motion: reduce) {
  .rank-line i, .risk-history-row i, .film-events button, .film-events button img { transition: none; }
  .risk-counts span, .rank li b { animation: none; }
}
</style>

