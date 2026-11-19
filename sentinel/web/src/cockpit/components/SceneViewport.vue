<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Target } from '../types';
import { useSceneStore } from '../stores/scene';
import { useCanvas } from '../composables/useCanvas';
import { useRecordedCamera } from '../composables/useRecordedCamera';
import { sampleField } from '../../core/RealDataAdapter';
import { useVideoSource } from '../composables/useVideoSource';
import { riskGrid, riskParams } from '../core/risk';
import { contourPath } from '../core/contours';
import {
  paintMap,
  paintMeasuredMap,
  paintCamera,
  cameraTargets,
  mapTargets,
  radarOverlay,
  groundMap,
  text,
  type ViewMode,
  type Hit,
  type PlotBounds,
} from '../renderers/lightScene';
import UiIcon from './UiIcon.vue';
const props = defineProps<{ mode: ViewMode; targets: Target[]; time: number; compact?: boolean; minimap?: boolean }>();
const store = useSceneStore(),
  canvas = ref<HTMLCanvasElement | null>(null),
  video = ref<HTMLVideoElement | null>(null);
const {
  sourceDialog,
  sourceType,
  sourceUrl,
  sourceError,
  validationError,
  videoReady,
  openSource,
  applySource,
  onVideoReady,
  getImage,
} = useVideoSource(video);
const recordedCamera = useRecordedCamera(video, computed(() => props.mode === 'camera'));
const measured = computed(() => store.connection !== 'mock');
const captured = computed(() => store.frame.source==='recording'||store.frame.source==='live');
const fillViewport = ref(true);
const forwardRadar = computed(() => props.compact && fillViewport.value &&
  !store.frame.targets.some(t => t.radar && t.radar.range * Math.cos(t.radar.azimuth * Math.PI / 180) < -2));
const worldBounds = computed<PlotBounds | undefined>(() => {
  if (!measured.value) return;
  if (props.mode === 'radar') {
    const r = store.frame.radarRange ?? 50;
    return { xMin: -r, xMax: r, yMin: forwardRadar.value ? -r * .05 : -r, yMax: r };
  }
  return store.frame.bounds ?? {xMin:-18,xMax:18,yMin:0,yMax:47};
});
function imageBox(sw: number, sh: number, w: number, h: number) {
  const ratio = props.compact && fillViewport.value ? Math.max(w/sw,h/sh) : Math.min(w/sw,h/sh);
  return { x: (w-sw*ratio)/2, y: (h-sh*ratio)/2, w: sw*ratio, h: sh*ratio };
}
const contoursVisible = ref(true),
  trailsVisible = ref(true),
  hover = ref<{ x: number; y: number; value: number | undefined; worldX?: number; worldY?: number } | null>(null);
const base = document.createElement('canvas'),
  heat = document.createElement('canvas');
heat.width = riskGrid.width;
heat.height = riskGrid.height;
let lastFieldStamp = '';
let nextCameraTiming = 0;
let cacheKey = '',
  hits: Hit[] = [],
  worker: Worker | undefined,
  busy = false,
  queued = false,
  disposed = false,
  fieldId = '',
  values = new Float32Array(128 * 96),
  paths: Path2D[] = [],
  contribution = new Path2D();
const levels = Array.from({ length: 28 }, (_, i) => (i + 1) * 0.03);
const measuredLevels = [.01, .02, .05, .1, .2, .3, .4, .5, .6, .75, .85, .95];
// 与浅色城市底图配合的高对比色带，只在高场值核心使用暖红。
const fieldPalette = [
  [0, 147, 190, 196, 35],
  [0.2, 131, 198, 181, 85],
  [0.4, 166, 210, 180, 115],
  [0.58, 222, 211, 155, 140],
  [0.75, 211, 160, 128, 170],
  [1, 184, 96, 78, 195],
];
function prepareMeasuredField() {
  const f=store.frame.riskField;
  if(hover.value?.worldX!==undefined && hover.value.worldY!==undefined)hover.value.value=sampleField(f,hover.value.worldX,hover.value.worldY);
  const stamp=f ? [f.revision ?? f.timestamp,f.width,f.height,f.scope].join(':') : 'none';
  if(stamp===lastFieldStamp)return;
  lastFieldStamp=stamp;
  paths=[];values=new Float32Array(0);heat.width=f?.width??1;heat.height=f?.height??1;
  if(!f)return;
  const ctx=heat.getContext('2d')!,im=ctx.createImageData(f.width,f.height);
  values=new Float32Array(f.width*f.height).fill(NaN);
  for(let row=0;row<f.height;row++)for(let col=0;col<f.width;col++){
    const src=row*f.width+col,dst=(f.height-1-row)*f.width+col;
    if(!f.valid[src]||!Number.isFinite(f.values[src]))continue;
    const v=f.values[src];values[dst]=v;
    const stop=fieldPalette.findIndex(e=>e[0]>=v),b=fieldPalette[Math.max(1,stop)],a=fieldPalette[Math.max(0,stop-1)],t=(v-a[0])/(b[0]-a[0]);
    im.data.set([1,2,3,4].map(k=>Math.round(a[k]+(b[k]-a[k])*t)),dst*4);
  }
  ctx.putImageData(im,0,0);paths=measuredLevels.map(v=>contourPath(values,f.width,f.height,v));
}
function requestField() {
  if(measured.value){if(props.mode==='risk')prepareMeasuredField();return;}
  if (!worker || disposed || props.mode !== 'risk') return;
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  worker.postMessage({
    targets: store.frame.targets,
    grid: riskGrid,
    params: riskParams,
    selectedId: store.selectedId,
  });
}
onMounted(() => {
  if(import.meta.env.VITE_STREAM_MODE!=='mock'){requestField();return;}
  worker = new Worker(new URL('../core/risk.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    busy = false;
    if (data.selectedId === store.selectedId && (store.playing || fieldId !== data.selectedId)) {
      values = data.values;
      fieldId = data.selectedId;
      paths = levels.map((v) => contourPath(values, 128, 96, v));
      contribution = contourPath(data.contribution, 128, 96, 0.12);
      const ctx = heat.getContext('2d')!,
        im = ctx.createImageData(128, 96);
      for (let i = 0; i < values.length; i++) {
        const v = Math.max(0, Math.min(1, values[i]));
        const stop = fieldPalette.findIndex((entry) => entry[0] >= v);
        const b = fieldPalette[Math.max(1, stop)], a = fieldPalette[Math.max(0, stop - 1)];
        const t = (v - a[0]) / (b[0] - a[0]);
        im.data.set([1, 2, 3, 4].map((channel) => Math.round(a[channel] + (b[channel] - a[channel]) * t)), i * 4);
      }
      ctx.putImageData(im, 0, 0);
    }
    if (queued) {
      queued = false;
      requestField();
    }
  };
  requestField();
});
watch(() => [store.frame.timestamp, store.selectedId, props.mode], requestField);
onUnmounted(() => {
  disposed = true;
  if(props.mode==='camera')store.cameraLatencyMs=null;
  worker?.terminate();
});
watch(()=>props.mode,(mode,previous)=>{if(previous==='camera'&&mode!=='camera')store.cameraLatencyMs=null;});
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
useCanvas(canvas, (ctx, w, h) => {
  const key = JSON.stringify(worldBounds.value) + measured.value + props.mode + ':' + w + ':' + h;
  if (cacheKey !== key) {
    base.width = w;
    base.height = h;
    const b = base.getContext('2d')!;
    if(props.mode === 'camera') paintCamera(b,w,h);
    else if(props.minimap) { b.fillStyle='#e0eff0';b.fillRect(0,0,w,h); }
    else if(worldBounds.value) paintMeasuredMap(b,w,h,worldBounds.value);
    else paintMap(b,w,h);
    cacheKey = key;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(base, 0, 0);
  if (props.mode === 'camera') {
    let box = { x: 0, y: 0, w, h };
    if(captured.value) {
      const ready=recordedCamera.ready.value;
      const now=Date.now();
      if(now>=nextCameraTiming){
        store.cameraLatencyMs=ready&&store.frame.source==='live'&&store.playing?Math.max(0,now-ready.meta.timestamp):null;
        nextCameraTiming=now+250;
      }
      ctx.fillStyle='#e5eeee';ctx.fillRect(0,0,w,h);
      if(ready){
        box=imageBox(ready.meta.width,ready.meta.height,w,h);
        const v=video.value;
        const image=v && v.readyState>=2 && !v.seeking && Math.abs(v.currentTime-(ready.meta.videoTimeSeconds??-1))<.06 ? v : ready.image;
        ctx.drawImage(image,box.x,box.y,box.w,box.h);
        hits=cameraTargets(ctx,w,h,ready.targets,store.selectedId,false,box);
      }else{
        box=imageBox(store.frame.cameraFrame?.width??800,store.frame.cameraFrame?.height??448,w,h);
        hits=cameraTargets(ctx,w,h,props.targets,store.selectedId,false,box);
        text(ctx,store.frame.live?.camera.message??'当前时刻无可用录像帧 · 检测数据工程投影',w/2,h/2,'#466e82',15,'center');
      }
    } else if (store.videoSource.type !== 'mock') {
      ctx.fillStyle = '#e5eded';
      ctx.fillRect(0, 0, w, h);
      const image = store.videoSource.type === 'carla' ? getImage() : video.value;
      if (image && videoReady.value) {
        const sw = image instanceof HTMLVideoElement ? image.videoWidth : image.width,
          sh = image instanceof HTMLVideoElement ? image.videoHeight : image.height;
        if (sw && sh) {
          box = imageBox(sw,sh,w,h);
          ctx.drawImage(image, box.x, box.y, box.w, box.h);
        }
      } else
        text(ctx, sourceError.value || '正在等待图像流…', w / 2, h / 2, '#708a8c', 16, 'center');
    }
    if(!captured.value) hits =
      store.videoSource.type === 'mock' || videoReady.value
        ? cameraTargets(
            ctx,
            w,
            h,
            props.targets,
            store.selectedId,
            store.videoSource.type === 'mock' && !measured.value,
            box,
          )
        : [];
  } else {
    if (props.mode === 'radar') radarOverlay(ctx, w, h, reduced.matches ? 0 : props.time, worldBounds.value, store.frame.radarRange ?? 200, props.minimap);
    else if(measured.value) {
      const f=store.frame.riskField;
      if(f){
        const {map,scaleX,scaleY}=groundMap(w,h,worldBounds.value),[x,y]=map(f.xAxis[0],f.yAxis[f.height-1]);
        const sx=(f.xAxis[f.width-1]-f.xAxis[0])*scaleX/(f.width-1),sy=(f.yAxis[f.height-1]-f.yAxis[0])*scaleY/(f.height-1);
        ctx.save();ctx.translate(x,y);ctx.scale(sx,sy);ctx.drawImage(heat,0,0,f.width-1,f.height-1);
        if(contoursVisible.value)paths.forEach((p,i)=>{ctx.strokeStyle=measuredLevels[i]>.4?'#fff8e6bb':'#599e967c';ctx.lineWidth=(i%5===0?1.1:.65)/Math.max(sx,sy);ctx.stroke(p);});
        ctx.restore();
      }
    } else {
      const { map, scale } = groundMap(w, h),
        [x, y] = map(-200, 200);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale((400 * scale) / 127, (400 * scale) / 95);
      ctx.drawImage(heat, 0, 0, 127, 95);
      if (contoursVisible.value)
        paths.forEach((p, i) => {
          ctx.strokeStyle = levels[i] > 0.35 ? '#fffbe5c0' : '#2589938f';
          ctx.lineWidth = i % 5 === 0 ? 0.32 : 0.19;
          ctx.stroke(p);
        });
      if (fieldId === store.selectedId) {
        ctx.strokeStyle = '#366f6b80';
        ctx.lineWidth = 0.25;
        ctx.setLineDash([1.4, 1.1]);
        ctx.stroke(contribution);
      }
      ctx.restore();
    }
    hits = mapTargets(ctx, w, h, props.targets, store.selectedId, props.mode, trailsVisible.value, worldBounds.value, !props.minimap);
  }
});
function point(event: MouseEvent) {
  const r = canvas.value!.getBoundingClientRect();
  return {
    x: ((event.clientX - r.left) * canvas.value!.clientWidth) / r.width,
    y: ((event.clientY - r.top) * canvas.value!.clientHeight) / r.height,
  };
}
function select(event: MouseEvent) {
  const { x, y } = point(event),
    hit = [...hits].reverse().find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
  if (hit) store.select(hit.id);
  if (store.frame.source!=='recording' && store.videoSource.type === 'video' && store.playing) void video.value?.play().catch(() => {});
}
function inspect(event: MouseEvent) {
  if (props.mode !== 'risk') return;
  const { x, y } = point(event),
    w = canvas.value!.clientWidth,
    h = canvas.value!.clientHeight,
    { map, scale, scaleX, scaleY } = groundMap(w, h, worldBounds.value),
    [ox, oy] = map(0, 0);
  if(measured.value){const worldX=(x-ox)/scaleX,worldY=(oy-y)/scaleY;hover.value={x:Math.min(w-150,x+14),y:Math.max(48,y-40),worldX,worldY,value:sampleField(store.frame.riskField,worldX,worldY)};return;}
  const col = Math.round((((x - ox) / scale + 200) / 400) * 127),
    row = Math.round(((200 - (oy - y) / scale) / 400) * 95);
  hover.value =
    col < 0 || col > 127 || row < 0 || row > 95
      ? null
      : { x: Math.min(w - 150, x + 14), y: Math.max(48, y - 40), value: values[row * 128 + col] };
}
</script>
<template>
  <div class="scene-viewport" :class="'view-' + mode">
    <video
      v-if="mode === 'camera' && (store.frame.cameraFrame?.videoUrl || store.videoSource.type === 'video')"
      ref="video"
      :src="store.frame.source === 'recording' ? undefined : store.frame.cameraFrame?.videoUrl || store.videoSource.url"
      muted
      playsinline
      :loop="store.frame.source !== 'recording'"
      preload="metadata"
      class="video-decoder"
      @loadeddata="store.frame.source === 'recording' ? recordedCamera.syncVideo() : onVideoReady()"
      @loadedmetadata="store.frame.source === 'recording' && recordedCamera.syncVideo()"
      @error="sourceError = '视频无法加载，请检查地址与格式'"
    />
    <canvas
      ref="canvas"
      :data-selected-target="store.selectedId"
      :data-view="mode"
      :data-framing="mode === 'risk' ? 'metric' : !compact || !fillViewport ? 'complete' : mode === 'camera' ? 'cover' : forwardRadar ? 'forward' : 'complete'"
      :data-camera-sequence="recordedCamera.ready.value?.meta.sequence"
      :data-camera-timestamp="recordedCamera.ready.value?.meta.timestamp"
      :data-field-timestamp="store.frame.riskField?.timestamp"
      :data-field-scope="store.frame.riskField?.scope"
      @click="select"
      @mousemove="inspect"
      @mouseleave="hover = null"
      :aria-label="
        mode === 'camera'
          ? '摄像头检测画面，点击检测框选择目标'
          : mode === 'radar'
            ? '雷达探测画面，点击目标选择'
            : '风险场等高线，点击目标选择'
      "
    />
    <div class="scene-caption">
      <span
        ><i class="live-dot" />
        {{
          mode === 'camera'
            ? store.frame.live ? store.frame.live.camera.state==='streaming' ? '实时摄像头 · LIVE RTSP / AI DETECTION' : '实时摄像头 · 等待网络视频' : measured ? '实测录像 · 原始像素检测' : '城市道路 · 高位视角'
            : mode === 'radar'
              ? store.frame.live ? '实物雷达 · LIVE TCP / TCR300' : measured ? '实测点迹 · SENSOR XY' : '全向探测 · LOCAL ENU'
              : store.frame.live ? store.frame.riskField ? '实时雷达风险场 · 相对风险估计' : '实时风险场 · 等待有效雷达数据' : measured ? '实测风险矩阵 · SENSOR XY' : '空间风险分布 · LOCAL ENU'
        }}</span
      ><span class="scene-caption-right"
        >{{
          mode === 'camera'
            ? captured ? 'FRAME '+(recordedCamera.ready.value?.meta.sequence ?? '—') : store.videoSource.type.toUpperCase()
            : mode === 'radar'
              ? (forwardRadar ? '前向视图 / ' : 'PPI / ')+(store.frame.radarRange??200)+' m'
              : store.frame.riskField ? store.frame.riskField.width+' × '+store.frame.riskField.height : measured ? '风险未知' : '128 × 96'
        }}<b>{{ store.playing ? '同步运行' : '已暂停' }}</b></span
      >
    </div>
    <div v-if="mode !== 'camera'" class="compass">
      <span>{{ store.frame.northCalibrated===false ? "+Y" : "N" }}</span
      ><svg viewBox="0 0 40 40"><path d="m20 5 9 28-9-6-9 6Z" fill="currentColor" /></svg
      ><small>{{ store.frame.northCalibrated===false ? "传感器 0°" : "正北 0°" }}</small>
    </div>
    <div v-if="mode === 'camera'" class="camera-location">
      <span>CAMERA 01</span><strong>{{ store.frame.live ? "网络摄像头 · 实时接入" : measured ? "实测录像 · 原始采集画面" : "中央大道交叉口" }}</strong
      ><small>{{
        store.frame.live ? store.frame.live.camera.message : measured ? '采样录像自带标注 / 原始 BBox 叠加' : store.videoSource.type === 'mock' ? '模拟场景 / 视觉与雷达融合' : '外部图像 / 融合检测叠加'
      }}</small>
    </div>
    <div class="scene-bottom">
      <span>{{
        mode === 'camera'
          ? 'OBJECT DETECTION + SENSOR FUSION'
          : mode === 'radar'
            ? 'RANGE · AZIMUTH · VELOCITY'
            : store.frame.live ? 'XY 等比例 · 圆形风险范围 / 未联合标定' : measured ? 'XY 等比例 · RECORDED FIELD / VALID MASK' : 'RISK DISTRIBUTION / DEMO MODEL'
      }}</span
      ><span>{{ store.selectedId }}<i />{{ ((store.frame.replay?.positionMs ?? (store.frame.live ? store.frame.timestamp-store.frame.live.startedAt : store.frame.timestamp)) / 1000).toFixed(1) }} s</span>
    </div>
    <div v-if="mode === 'camera' && compact" class="scene-tools">
      <span v-if="fillViewport">等比裁切</span>
      <button @click="fillViewport = !fillViewport">{{ fillViewport ? '完整画面' : '铺满画面' }}</button>
    </div>
    <div v-else-if="mode === 'camera' && !captured" class="scene-tools">
      <span>图像源</span
      ><button
        v-for="t in ['mock', 'video', 'carla'] as const"
        :key="t"
        @click="openSource(t)"
        :class="{ active: store.videoSource.type === t }"
      >
        {{ t.toUpperCase() }}
      </button>
    </div>
    <div v-else-if="mode !== 'camera'" class="scene-tools">
      <button v-if="compact && mode === 'radar'" @click="fillViewport = !fillViewport">
        {{ fillViewport ? '完整视野' : '前向视图' }}
      </button>
      <button
        v-if="mode === 'risk'"
        :aria-pressed="contoursVisible"
        :class="{ active: contoursVisible }"
        @click="contoursVisible = !contoursVisible"
      >
        <UiIcon name="layers" :size="16" />等高线</button
      ><button
        :aria-pressed="trailsVisible"
        :class="{ active: trailsVisible }"
        @click="trailsVisible = !trailsVisible"
      >
        航迹
      </button>
    </div>
    <div v-if="!compact && store.selected && mode === 'camera' && !store.selected.camera" class="view-notice">
      {{ store.selectedId }} 当前帧没有对应的视觉检测框
    </div>
    <div v-if="!compact && store.selected && mode === 'radar' && !store.selected.radar" class="view-notice">
      {{ store.selectedId }} 为仅视觉目标，当前无雷达回波
    </div>
    <div v-if="measured && mode==='risk' && !store.frame.riskField" class="view-notice">当前时刻风险场不可用 · 未知区域不视为零风险</div>
    <div v-else-if="mode==='risk' && store.frame.source==='live' && !store.frame.targets.some(t=>t.radar)" class="view-notice">雷达在线，当前无目标 · 等待目标进入探测范围</div>
    <div v-if="sourceError && !sourceDialog && mode === 'camera'" class="view-notice error">
      {{ sourceError }}
    </div>
    <div
      v-if="hover && mode === 'risk'"
      class="field-tooltip"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
    >
      场值 {{ hover.value?.toFixed(3) ?? '未知 / 超出有效区域' }}
    </div>
    <div v-if="sourceDialog" class="dialog-backdrop" @click.self="sourceDialog = false">
      <form class="source-dialog" @submit.prevent="applySource">
        <span class="eyebrow">EXTERNAL VIDEO SOURCE</span>
        <h3>{{ sourceType === 'carla' ? '连接 CARLA 图像流' : '接入视频源' }}</h3>
        <p>
          {{
            sourceType === 'carla'
              ? '发送 JPEG / PNG 二进制帧的 WebSocket 地址'
              : '浏览器可解码的 MP4 / WebM 地址，检测数据由统一接口提供'
          }}
        </p>
        <input
          v-model="sourceUrl"
          required
          aria-label="视频源地址"
          :placeholder="
            sourceType === 'carla'
              ? 'ws://localhost:8765/camera'
              : 'http://localhost:8000/drive.mp4'
          "
        />
        <p v-if="validationError || sourceError" class="warm">{{ validationError || sourceError }}</p>
        <div class="dialog-actions">
          <button type="button" @click="sourceDialog = false">取消</button
          ><button type="submit" class="primary-button">连接画面</button>
        </div>
      </form>
    </div>
  </div>
</template>
