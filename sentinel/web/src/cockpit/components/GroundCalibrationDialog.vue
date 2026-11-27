<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { VehicleResult } from '../../../../sentinel-backend/src/vehicle/contracts';

type Vision = NonNullable<NonNullable<VehicleResult['capture']>['vision']>;
type FramePoint = { u: number; v: number };
type DraftPoint = { image: FramePoint | null; x: number | ''; y: number | '' };
const props = defineProps<{ endpoint: URL }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const vision = shallowRef<Vision | null>(null);
const imageUrl = ref('');
const points = ref<DraftPoint[]>(Array.from({length:4}, () => ({image:null, x:'', y:''})));
const selected = ref(0);
const loading = ref(false), saving = ref(false), saved = ref(false), error = ref('');
const ready = computed(() => !!vision.value && !!imageUrl.value && points.value.every(p =>
  p.image && Number.isFinite(p.x) && Number.isFinite(p.y)));
const outline = computed(() => points.value.flatMap(p => p.image ? [p.image.u + ',' + p.image.v] : []).join(' '));
let pending: AbortController | undefined;

function api(path: string) { return new URL('/api/vehicle/' + path, props.endpoint); }
function releaseImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = '';
}
async function takeFrame() {
  pending?.abort();
  const operation = pending = new AbortController();
  const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(4000)]);
  loading.value = true;
  error.value = '';
  saved.value = false;
  releaseImage();
  vision.value = null;
  points.value.forEach(p => { p.image = null; });
  selected.value = 0;
  try {
    const response = await fetch(api('frame'), {cache:'no-store', signal});
    if (!response.ok) throw Error('未能连接车路协同后端。');
    const frame: VehicleResult = await response.json();
    const camera = frame.capture;
    if (!camera?.vision || camera.status.state !== 'streaming')
      throw Error('等待监控实时画面。接通后点击「重新取帧」。');
    const image = new URL(camera.vision.imageUrl, props.endpoint);
    image.searchParams.set('at', String(Date.parse(camera.vision.captured_utc)));
    const jpeg = await fetch(image, {cache:'no-store', signal});
    if (!jpeg.ok) throw Error('这一帧已经过期，请重新取帧。');
    const blob = await jpeg.blob();
    if (operation.signal.aborted) return;
    vision.value = camera.vision;
    imageUrl.value = URL.createObjectURL(blob);
  } catch (cause) {
    if (!operation.signal.aborted) error.value = cause instanceof Error ? cause.message : '取帧失败。';
  } finally {
    if (pending === operation) loading.value = false;
  }
}
function mark(event: MouseEvent) {
  if (loading.value || saving.value || saved.value || !imageUrl.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const limit = (n: number) => Math.max(0, Math.min(1, n));
  points.value[selected.value]!.image = {
    u:limit((event.clientX - rect.left) / rect.width),
    v:limit((event.clientY - rect.top) / rect.height),
  };
  const next = points.value.findIndex(p => p.image === null);
  if (next !== -1) selected.value = next;
}
async function save() {
  const image = vision.value;
  if (!image || !ready.value || loading.value || saving.value || saved.value) return;
  const operation = pending = new AbortController();
  saving.value = true;
  error.value = '';
  try {
    const response = await fetch(api('calibration'), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        width:image.width, height:image.height,
        points:points.value.map(p => ({...p.image, x:p.x, y:p.y})),
      }),
      signal:AbortSignal.any([operation.signal, AbortSignal.timeout(4000)]),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.saved !== true)
      throw Error(result?.error ?? '保存失败，请确认正在运行新版车路协同后端。');
    if (!operation.signal.aborted) saved.value = true;
  } catch (cause) {
    if (!operation.signal.aborted) error.value = cause instanceof Error ? cause.message : '保存失败。';
  } finally {
    if (pending === operation) saving.value = false;
  }
}
function close() { if (!saving.value) emit('close'); }

onMounted(() => {
  dialog.value?.showModal();
  void takeFrame();
});
onUnmounted(() => {
  pending?.abort();
  releaseImage();
});
</script>

<template>
  <dialog ref="dialog" class="ground-calibration" aria-labelledby="ground-calibration-title" @cancel.prevent="close">
    <header>
      <h2 id="ground-calibration-title">监控地面标定</h2>
      <button type="button" :disabled="saving" @click="close">关闭</button>
    </header>
    <p class="instructions">在实际地面选一个量好的四角区域，按顺序点击监控画面中的四个角，填写各点相对于同一原点的 X、Y 坐标（米）。</p>
    <div class="calibration-grid">
      <section>
        <div v-if="imageUrl && vision" class="calibration-image" @click="mark">
          <img :src="imageUrl" :width="vision.width" :height="vision.height" alt="当前监控的冻结画面" draggable="false" />
          <svg class="detection-boxes" :viewBox="'0 0 ' + vision.width + ' ' + vision.height" aria-hidden="true">
            <rect v-for="(box, index) in vision.detections" :key="index" :x="box.x" :y="box.y" :width="box.width" :height="box.height" />
          </svg>
          <svg class="coverage" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <polygon v-if="points.every(p => p.image)" :points="outline" />
          </svg>
          <template v-for="(point, index) in points" :key="index">
            <span v-if="point.image" class="point-marker" :class="{ selected: index === selected }"
              :style="{left:(point.image.u * 100) + '%', top:(point.image.v * 100) + '%'}">{{ index + 1 }}</span>
          </template>
        </div>
        <div v-else class="waiting-frame">{{ loading ? '正在从监控取帧…' : '等待监控实时画面' }}</div>
        <div class="frame-actions">
          <span v-if="vision">冻结帧 #{{ vision.sequence }} · {{ vision.width }}×{{ vision.height }} · {{ vision.detections.length }} 个检测框</span>
          <button type="button" :disabled="loading || saving" @click="takeFrame">重新取帧</button>
        </div>
      </section>

      <form @submit.prevent="save">
        <fieldset :disabled="!imageUrl || loading || saving || saved">
          <legend>选择要在画面中标出的点</legend>
          <div v-for="(point, index) in points" :key="index" class="coordinate-row">
            <button type="button" :aria-pressed="selected === index" @click="selected = index">
              点 {{ index + 1 }}<span v-if="point.image" aria-label="已取点"> ✓</span>
            </button>
            <label>X（米）<input v-model="point.x" type="number" step="any" required :aria-label="'点 ' + (index + 1) + ' X（米）'" /></label>
            <label>Y（米）<input v-model="point.y" type="number" step="any" required :aria-label="'点 ' + (index + 1) + ' Y（米）'" /></label>
          </div>
        </fieldset>
        <div class="save-actions">
          <button v-if="saved" class="primary" type="button" @click="close">返回实时画面</button>
          <button v-else class="primary" type="submit" :disabled="!ready || loading || saving">{{ saving ? '正在保存…' : '保存并应用标定' }}</button>
        </div>
      </form>
    </div>
    <p v-if="error" role="alert" class="calibration-error">{{ error }}</p>
    <p v-else-if="saved" role="status" class="calibration-success">已保存。返回实时画面后，进入标定区域的检测目标会显示地面坐标。</p>
  </dialog>
</template>

<style scoped>
.ground-calibration {
  width: min(960px, calc(100vw - 28px)); max-height: calc(100dvh - 28px); margin: auto;
  padding: 20px; overflow: auto; background: #edf7fa; color: #153d55;
  border: 1px solid #a5cbd6; border-radius: 12px; box-shadow: 0 18px 60px #15383f70;
}
.ground-calibration::backdrop { background: #15383f99; }
header, .frame-actions, .save-actions { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
header h2 { font-size: 20px; font-weight: 700; }
.instructions { margin: 8px 0 14px; font-size: 13px; }
.calibration-grid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(245px, 1fr); gap: 16px; }
.calibration-image { position: relative; cursor: crosshair; touch-action: manipulation; }
.calibration-image img { display: block; width: 100%; height: auto; border-radius: 5px; }
.calibration-image svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.detection-boxes rect { fill: none; stroke: #7ef6ac; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.coverage polygon { fill: #40caca25; stroke: #32f1d2; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.point-marker {
  position: absolute; display: grid; place-items: center; width: 22px; height: 22px;
  border-radius: 50%; background: #126873; color: white; font-size: 12px; font-weight: 700;
  border: 1px solid white; transform: translate(-50%, -50%); pointer-events: none;
}
.point-marker.selected { background: #845912; }
.waiting-frame { display: grid; place-items: center; min-height: 156px; background: #dcecf1; border-radius: 5px; }
.frame-actions { margin-top: 8px; font-size: 12px; flex-wrap: wrap; }
fieldset { min-width: 0; padding: 0; border: 0; }
legend { font-size: 13px; margin-bottom: 5px; }
.coordinate-row { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); align-items: end; gap: 6px; margin-top: 7px; }
label { display: grid; gap: 3px; font-size: 12px; }
input, .ground-calibration button {
  background: #fbfdfe; color: #194a64; border: 1px solid #a5cbd6;
  border-radius: 5px; padding: 4px 7px; font-size: 13px;
}
input { width: 100%; }
.ground-calibration button[aria-pressed="true"] { background: #d5efeb; border-color: #168478; }
.ground-calibration .primary { color: white; background: #146873; padding: 7px 10px; }
.ground-calibration button:disabled { opacity: .55; cursor: default; }
.save-actions { justify-content: flex-end; margin-top: 12px; }
.calibration-error, .calibration-success { margin-top: 10px; font-size: 13px; }
.calibration-error { color: #9b2926; }
.calibration-success { color: #136653; }
@media (max-width: 690px) {
  .calibration-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
