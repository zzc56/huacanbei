<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useSceneStore } from '../stores/scene';

type ControlPoint = { u: number; v: number; x: number; y: number };
type Calibration = {
  width: number;
  height: number;
  cameraOffsetMs: number;
  alignmentWindowMs: number;
  points: ControlPoint[];
};
type Saved = { settings: Calibration; rmsErrorM: number; maxErrorM: number };
type RadarPoint = { id: string; name: string; x: number; y: number; timestamp: number };

const emptySettings = (): Calibration => ({ width: 0, height: 0, cameraOffsetMs: 0, alignmentWindowMs: 160, points: [] });
const emptyPoint = () => ({ u: '' as number | '', v: '' as number | '', x: '' as number | '', y: '' as number | '' });
const store = useSceneStore();
const dialog = ref<HTMLDialogElement | null>(null);
const settings = ref(emptySettings());
const pending = ref(emptyPoint());
const frozen = ref<{ url: string; width: number; height: number; sequence: number; timestamp: number }>();
const radarPoints = ref<RadarPoint[]>([]);
const radarPointId = ref('');
const saved = ref<Saved | null>(null);
const operation = ref<'load' | 'save' | 'freeze' | null>(null);
const error = ref('');
const notice = ref('');
const ready = ref(false);
const cameraEvent = ref('');
const radarEvent = ref('');
const requests = new AbortController();
const association = computed(() => {
  if (store.frame.source !== 'live') return;
  const status = store.frame.live?.association;
  if (status?.state !== 'active') return status?.message;
  const count = store.frame.targets.filter(target => target.autoAssociation?.status === 'matched').length;
  return `当前帧匹配 ${count} 个目标`;
});
const canAdd = computed(() => settings.value.points.length < 12 &&
  [pending.value.u, pending.value.v, pending.value.x, pending.value.y].every(value => typeof value === 'number' && Number.isFinite(value)) &&
  Number(pending.value.u) >= 0 && Number(pending.value.u) <= 1 && Number(pending.value.v) >= 0 && Number(pending.value.v) <= 1 &&
  Math.abs(Number(pending.value.x)) <= 2000 && Math.abs(Number(pending.value.y)) <= 2000);

function clearImage() {
  if (frozen.value) URL.revokeObjectURL(frozen.value.url);
  frozen.value = undefined;
  radarPoints.value = [];
  radarPointId.value = '';
}

onUnmounted(() => {
  requests.abort();
  clearImage();
});

async function update(action: 'load' | 'save') {
  if (operation.value) return;
  operation.value = action;
  error.value = '';
  notice.value = '';
  try {
    const response = await fetch('/api/live/calibration', {
      signal: requests.signal,
      ...(action === 'save' ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.value),
      } : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !('calibration' in result)) {
      error.value = result?.message || '无法读取标定，请确认实时服务已启动。';
      return;
    }
    saved.value = result.calibration as Saved | null;
    settings.value = saved.value
      ? { ...saved.value.settings, points: [...saved.value.settings.points] }
      : { ...emptySettings(), width: store.frame.cameraFrame?.width ?? 0, height: store.frame.cameraFrame?.height ?? 0 };
    ready.value = true;
    if (action === 'save') notice.value = '标定已保存，实时连接已应用。';
  } catch {
    if (!requests.signal.aborted) error.value = '无法连接实时服务，请稍后重试。';
  } finally {
    operation.value = null;
  }
}

function open() {
  if (!dialog.value || dialog.value.open || operation.value) return;
  ready.value = false;
  pending.value = emptyPoint();
  saved.value = null;
  cameraEvent.value = '';
  radarEvent.value = '';
  dialog.value.showModal();
  void update('load');
}

async function freeze() {
  if (operation.value) return;
  error.value = '';
  notice.value = '';
  const { cameraFrame, live, source } = store.frame;
  if (!store.playing || source !== 'live' || live?.camera.state !== 'streaming' || !cameraFrame?.imageUrl ||
    !Number.isFinite(cameraFrame.timestamp) || Date.now() - store.frame.timestamp > 1500) {
    error.value = '接通摄像头并恢复实时播放后，再冻结画面。';
    return;
  }
  const { width, height, sequence, timestamp, imageUrl } = cameraFrame;
  if (settings.value.points.length && (settings.value.width !== width || settings.value.height !== height)) {
    error.value = '画面尺寸已经变化。删除旧控制点后，再冻结新画面。';
    return;
  }
  const query = new URLSearchParams({
    sequence: String(sequence), offset: String(settings.value.cameraOffsetMs), window: String(settings.value.alignmentWindowMs),
  });
  operation.value = 'freeze';
  try {
    const fetchOptions = { signal: requests.signal, cache: 'no-store' as const };
    const [response, observations] = await Promise.all([
      fetch(imageUrl, fetchOptions),
      fetch('/api/live/calibration/observations?' + query, fetchOptions)
        .then(result => result.ok ? result.json() : null)
        .catch(() => null),
    ]);
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/jpeg')) throw Error('Frame unavailable');
    const image = await response.blob();
    if (requests.signal.aborted) return;
    clearImage();
    frozen.value = { url: URL.createObjectURL(image), width, height, sequence, timestamp };
    radarPoints.value = ((observations?.observations ?? []) as (Omit<RadarPoint, 'id' | 'name'> & { id: number })[])
      .map(point => ({ ...point, id: String(point.id), name: '车辆 ' + point.id }));
    settings.value.width = width;
    settings.value.height = height;
    pending.value = emptyPoint();
  } catch {
    if (!requests.signal.aborted) error.value = '画面已过期，请再冻结一次。';
  } finally {
    operation.value = null;
  }
}

function selectPixel(event: MouseEvent) {
  const bounds = (event.currentTarget as HTMLImageElement).getBoundingClientRect();
  pending.value.u = Number(((event.clientX - bounds.left) / bounds.width).toFixed(5));
  pending.value.v = Number(((event.clientY - bounds.top) / bounds.height).toFixed(5));
}

function selectRadar() {
  const point = radarPoints.value.find(item => item.id === radarPointId.value);
  if (!point) return;
  pending.value.x = Number(point.x.toFixed(3));
  pending.value.y = Number(point.y.toFixed(3));
}

function addPoint() {
  if (!canAdd.value) return;
  const { u, v, x, y } = pending.value;
  if (settings.value.points.some(point => point.u === u && point.v === v)) {
    error.value = '这个画面位置已有控制点。';
    return;
  }
  settings.value.points.push({ u: Number(u), v: Number(v), x: Number(x), y: Number(y) });
  pending.value = emptyPoint();
  radarPointId.value = '';
  error.value = '';
  notice.value = '';
}

function estimateOffset() {
  const asMs = (value: string) => /^\d{13}$/.test(value.trim()) ? Number(value) : Date.parse(value.trim());
  const offset = asMs(cameraEvent.value) - asMs(radarEvent.value);
  if (!cameraEvent.value || !radarEvent.value || !Number.isFinite(offset) || Math.abs(offset) > 5000) {
    error.value = '请输入同一事件的两个有效时间戳，时间差须在 ±5000 ms 内。';
    return;
  }
  settings.value.cameraOffsetMs = offset;
  error.value = '';
  notice.value = '已填入时间偏移，保存后生效。';
}
</script>

<template>
  <button type="button" class="live-control" @click="open">雷视标定</button>
  <Teleport to="body">
    <dialog ref="dialog" class="calibration-dialog" aria-labelledby="calibration-title" @close="clearImage"
      @cancel="operation && $event.preventDefault()">
      <header>
        <div><h2 id="calibration-title">雷视标定</h2><p v-if="association">{{ association }}</p></div>
        <button type="button" class="close-button" aria-label="关闭雷视标定" :disabled="!!operation" @click="dialog?.close()">×</button>
      </header>
      <form :aria-busy="!!operation" @submit.prevent="update('save')">
        <fieldset :disabled="!ready || !!operation">
          <section aria-labelledby="spatial-calibration">
            <div class="section-header">
              <h3 id="spatial-calibration">空间标定</h3>
              <button type="button" @click="freeze">冻结实时画面</button>
            </div>
            <p>在两台设备共同覆盖的路面分散取 4–12 个点。点击车框底边中心对应的路面位置，再填写同一位置的实测雷达 X、Y。</p>
            <div v-if="frozen" class="frozen-image">
              <img :src="frozen.url" :width="frozen.width" :height="frozen.height" :alt="'冻结画面，第 ' + frozen.sequence + ' 帧'"
                draggable="false" @click="selectPixel" />
              <span v-for="(point, index) in settings.points" :key="index" class="marker"
                :style="{ left: point.u * 100 + '%', top: point.v * 100 + '%' }">{{ index + 1 }}</span>
              <span v-if="pending.u !== '' && pending.v !== ''" class="marker pending"
                :style="{ left: Number(pending.u) * 100 + '%', top: Number(pending.v) * 100 + '%' }">+</span>
            </div>
            <p v-if="frozen">画面时间 {{ new Date(frozen.timestamp).toISOString() }}</p>
            <label v-if="frozen && radarPoints.length">对应的实测雷达目标
              <select v-model="radarPointId" @change="selectRadar">
                <option value="">手动填写坐标</option>
                <option v-for="point in radarPoints" :key="point.id" :value="point.id">
                  {{ point.name }}（{{ point.x.toFixed(2) }}, {{ point.y.toFixed(2) }} m）
                </option>
              </select>
            </label>
            <p v-if="frozen && !radarPoints.length">当前帧在对齐窗口内没有雷达观测，可填写已测量的坐标。</p>
            <p v-if="radarPointId">雷达观测时间 {{ new Date(radarPoints.find(point => point.id === radarPointId)?.timestamp ?? 0).toISOString() }}</p>
            <div class="field-grid">
              <label>画面宽度（px）<input v-model.number="settings.width" :readonly="!!frozen || settings.points.length > 0" type="number" min="1" max="8192" required /></label>
              <label>画面高度（px）<input v-model.number="settings.height" :readonly="!!frozen || settings.points.length > 0" type="number" min="1" max="8192" required /></label>
            </div>
            <div class="field-grid points">
              <label>画面 U（0–1）<input v-model.number="pending.u" type="number" step="any" /></label>
              <label>画面 V（0–1）<input v-model.number="pending.v" type="number" step="any" /></label>
              <label>雷达 X（m）<input v-model.number="pending.x" type="number" step="any" /></label>
              <label>雷达 Y（m）<input v-model.number="pending.y" type="number" step="any" /></label>
              <button type="button" :disabled="!canAdd || !(settings.width > 0 && settings.height > 0)" @click="addPoint">添加控制点</button>
            </div>
            <table v-if="settings.points.length">
              <thead><tr><th scope="col">控制点</th><th scope="col">画面 U, V</th><th scope="col">雷达 X, Y（m）</th><th scope="col">操作</th></tr></thead>
              <tbody>
                <tr v-for="(point, index) in settings.points" :key="index">
                  <td>{{ index + 1 }}</td><td>{{ point.u.toFixed(4) }}, {{ point.v.toFixed(4) }}</td>
                  <td>{{ point.x.toFixed(2) }}, {{ point.y.toFixed(2) }}</td>
                  <td><button type="button" :aria-label="'删除控制点 ' + (index + 1)" @click="settings.points.splice(index, 1)">删除</button></td>
                </tr>
              </tbody>
            </table>
          </section>
          <section aria-labelledby="time-alignment">
            <h3 id="time-alignment">时间对齐</h3>
            <p>摄像头记录同一事件的时间晚于雷达时填正值。填负值时画面会延迟显示，以等候对应的雷达数据。</p>
            <p>对齐容差是校正后两路观测允许的时间差。</p>
            <div class="field-grid">
              <label>摄像头时间偏移（ms）<input v-model.number="settings.cameraOffsetMs" type="number" min="-5000" max="5000" step="any" required /></label>
              <label>对齐容差（ms）<input v-model.number="settings.alignmentWindowMs" type="number" min="20" max="500" step="any" required /></label>
            </div>
            <details>
              <summary>用同一事件的时间戳计算偏移</summary>
              <p>填写 Unix 毫秒时间戳，或含时区的 ISO 时间。</p>
              <div class="field-grid points">
                <label>摄像头事件时间<input v-model.trim="cameraEvent" type="text" spellcheck="false" /></label>
                <label>雷达事件时间<input v-model.trim="radarEvent" type="text" spellcheck="false" /></label>
                <button type="button" @click="estimateOffset">计算偏移</button>
              </div>
            </details>
          </section>
        </fieldset>
        <p v-if="saved" class="calibration-status">已保存 {{ saved.settings.points.length }} 个控制点 · 拟合均方根误差 {{ saved.rmsErrorM.toFixed(2) }} m · 最大偏差 {{ saved.maxErrorM.toFixed(2) }} m</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-else-if="notice" role="status">{{ notice }}</p>
        <p v-else-if="operation === 'load'" role="status">正在读取标定…</p>
        <footer>
          <button v-if="!ready && !operation" type="button" @click="update('load')">重试</button>
          <button v-else type="submit" :disabled="!ready || !!operation || settings.points.length < 4">{{ operation === 'save' ? '正在保存…' : '保存并应用' }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.calibration-dialog { position: fixed; inset: 0; box-sizing: border-box; width: min(740px, calc(100% - 24px)); height: fit-content; max-height: calc(100dvh - 24px); padding: 20px; margin: auto; overflow: auto; border: 1px solid #cad8e1; border-radius: 12px; background: #fcfeff; color: #17323c; box-shadow: 0 14px 48px #19394b38; font: 14px/1.5 'Microsoft YaHei', 'Segoe UI', sans-serif; }
.calibration-dialog::backdrop { background: #10283480; }
.calibration-dialog header, .section-header, .calibration-dialog footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.calibration-dialog h2, .calibration-dialog h3, .calibration-dialog p { margin: 0; }
.calibration-dialog h2 { font-size: 20px; }
.calibration-dialog h3 { font-size: 16px; }
.calibration-dialog p { color: #415d6a; }
.calibration-dialog fieldset { min-width: 0; padding: 0; margin: 14px 0 0; border: 0; }
.calibration-dialog section { display: grid; gap: 10px; padding: 13px 0; border-top: 1px solid #d6e4ec; }
.calibration-dialog label { display: grid; gap: 4px; min-width: 0; }
.field-grid { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
.field-grid label { flex: 1 1 140px; }
.points label { flex-basis: 82px; }
.calibration-dialog input, .calibration-dialog select, .calibration-dialog button { padding: 7px 10px; border: 1px solid #cad8e1; border-radius: 6px; min-width: 0; font: inherit; color: inherit; background: #fff; }
.calibration-dialog button { background: #eef6f9; color: #255e72; cursor: pointer; }
.calibration-dialog button:disabled { opacity: .55; cursor: default; }
.calibration-dialog .close-button { font-size: 20px; line-height: 1; }
.calibration-dialog footer { justify-content: flex-end; margin-top: 12px; }
.calibration-dialog footer button { border-color: #136a70; background: #136a70; color: #fff; }
.calibration-dialog table { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
.calibration-dialog th, .calibration-dialog td { padding: 5px; border-bottom: 1px solid #d6e4ec; }
.calibration-dialog td button { padding: 2px 8px; }
.calibration-dialog details[open] > * + * { margin-top: 6px; }
.calibration-dialog summary { color: #255e72; cursor: pointer; }
.calibration-dialog .error { color: #9d352c; }
.calibration-dialog .calibration-status { margin: 4px 0; }
.frozen-image { position: relative; justify-self: center; width: min(100%, 530px); }
.frozen-image img { display: block; width: 100%; height: auto; border-radius: 6px; cursor: crosshair; }
.marker { position: absolute; display: grid; place-items: center; width: 20px; height: 20px; border: 2px solid #fff; border-radius: 50%; background: #136a70; color: #fff; font-size: 11px; transform: translate(-50%, -50%); pointer-events: none; }
.marker.pending { background: #255e72; }
</style>
