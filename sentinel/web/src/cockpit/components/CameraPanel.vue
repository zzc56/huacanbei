<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import type { Target, VideoSource } from '../types';
import { useSceneStore } from '../stores/scene';
import { useCanvas } from '../composables/useCanvas';
import { label, line, targetColor } from '../core/drawing';
import PanelHeader from './PanelHeader.vue';
const props = defineProps<{ targets: Target[]; time: number }>();
const store = useSceneStore();
const canvas = ref<HTMLCanvasElement | null>(null),
  video = ref<HTMLVideoElement | null>(null);
const sourceDialog = ref(false),
  sourceType = ref<VideoSource['type']>('video'),
  sourceUrl = ref(''),
  sourceError = ref('');
const videoReady = ref(false);
let socket: WebSocket | undefined,
  carlaImage: ImageBitmap | undefined,
  sourceGeneration = 0;
let hits: { id: string; x: number; y: number; w: number; h: number }[] = [];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
function cleanupSource() {
  sourceGeneration++;
  if (socket) {
    socket.onmessage = socket.onerror = socket.onclose = null;
    socket.close();
    socket = undefined;
  }
  carlaImage?.close();
  carlaImage = undefined;
  videoReady.value = false;
}
watch(
  () => store.videoSource,
  (source) => {
    cleanupSource();
    sourceError.value = '';
    if (source.type === 'carla' && source.url) {
      const generation = sourceGeneration;
      let decoding = false;
      try {
        socket = new WebSocket(source.url);
        socket.binaryType = 'blob';
        socket.onerror = () => {
          sourceError.value = 'CARLA 图像流连接失败';
        };
        socket.onclose = () => {
          if (generation === sourceGeneration) sourceError.value = 'CARLA 图像流已断开';
        };
        socket.onmessage = async (event) => {
          if (!(event.data instanceof Blob) || !store.playing || decoding) return;
          decoding = true;
          try {
            const bitmap = await createImageBitmap(event.data);
            if (generation !== sourceGeneration) bitmap.close();
            else {
              carlaImage?.close();
              carlaImage = bitmap;
              videoReady.value = true;
            }
          } catch {
            sourceError.value = '无法解码 CARLA 图像帧';
          } finally {
            decoding = false;
          }
        };
      } catch {
        sourceError.value = '无法建立 CARLA 图像流';
      }
    }
  },
  { deep: true },
);
watch(
  () => store.playing,
  (playing) => {
    if (video.value && store.videoSource.type === 'video') {
      if (playing)
        void video.value.play().catch(() => {
          sourceError.value = '点击画面以允许视频播放';
        });
      else video.value.pause();
    }
  },
);
onUnmounted(cleanupSource);
function openSource(type: VideoSource['type']) {
  if (type === 'mock') {
    store.videoSource = { type: 'mock' };
    return;
  }
  sourceType.value = type;
  sourceUrl.value = store.videoSource.type === type ? store.videoSource.url || '' : '';
  sourceError.value = '';
  sourceDialog.value = true;
}
function applySource() {
  try {
    const url = new URL(sourceUrl.value, window.location.href);
    if (
      sourceType.value === 'carla'
        ? !['ws:', 'wss:'].includes(url.protocol)
        : !['http:', 'https:', 'blob:'].includes(url.protocol)
    )
      throw new Error();
    store.videoSource = { type: sourceType.value, url: url.href };
    sourceDialog.value = false;
  } catch {
    sourceError.value =
      sourceType.value === 'carla'
        ? '请输入 ws:// 或 wss:// 图像流地址'
        : '请输入 HTTP(S) 视频地址（浏览器可解码）';
  }
}
function onVideoReady() {
  videoReady.value = true;
  if (store.playing)
    void video.value?.play().catch(() => {
      sourceError.value = '点击画面以允许视频播放';
    });
}
function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#101e26');
  sky.addColorStop(0.4, '#43565e');
  sky.addColorStop(0.46, '#536567');
  sky.addColorStop(1, '#0c171b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // 程序化山脉、建筑与道路，无外部图片依赖。
  for (let layer = 0; layer < 3; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, h * 0.49);
    for (let x = 0; x <= w + 10; x += 10) {
      const y =
        h * (0.39 + layer * 0.026) -
        Math.sin(x * 0.011 + layer * 1.9) * h * 0.053 -
        Math.sin(x * 0.033 + layer) * h * 0.016;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h * 0.53);
    ctx.lineTo(0, h * 0.53);
    ctx.fillStyle = ['#34474c', '#2b3e43', '#20343a'][layer];
    ctx.fill();
  }
  for (let side = 0; side < 2; side++)
    for (let i = 0; i < 16; i++) {
      const x = side ? w - i * w * 0.027 : i * w * 0.028;
      const bh = (0.04 + (Math.sin(i * 7.2) * 0.5 + 0.5) * 0.17) * h;
      ctx.fillStyle = i % 2 ? '#24363c' : '#1a2b32';
      ctx.fillRect(x, h * 0.48 - bh, w * 0.023, bh);
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = '#9ab8a426';
        ctx.fillRect(x + 3, h * 0.48 - bh + k * 8 + 4, w * 0.012, 1);
      }
    }
  ctx.beginPath();
  ctx.moveTo(w * 0.435, h * 0.44);
  ctx.lineTo(w * 0.565, h * 0.44);
  ctx.lineTo(w * 1.08, h);
  ctx.lineTo(w * -0.08, h);
  ctx.closePath();
  const road = ctx.createLinearGradient(0, h * 0.44, 0, h);
  road.addColorStop(0, '#314044');
  road.addColorStop(1, '#26343c');
  ctx.fillStyle = road;
  ctx.fill();
  for (let i = 0; i < 60; i++) {
    const y = h * (0.45 + i * 0.0095);
    line(ctx, 0, y, w, y + 2, i % 3 ? '#adc1c203' : '#0000000c');
  }
  const project = (lane: number, depth: number) => [
    w * (0.5 + lane * (0.035 + depth * 0.19)),
    h * (0.44 + depth * 0.56),
  ];
  for (const lane of [-2.5, 2.5]) {
    const [a, b] = project(lane, 0),
      [c, d] = project(lane, 1);
    line(ctx, a, b, c, d, '#b0b9a87c', 2);
  }
  for (const lane of [-1.5, -0.5, 0.5, 1.5])
    for (let j = 0; j < 13; j++) {
      const z = ((j / 13 + (reduced.matches ? 0 : props.time * 0.16)) % 1) ** 2;
      const [a, b] = project(lane, z),
        [c, d] = project(lane, Math.min(1, z + 0.025 + z * 0.045));
      line(ctx, a, b, c, d, '#bbc8bb75', 0.5 + z * 3);
    }
  for (const side of [-1, 1])
    for (let i = 1; i <= 8; i++) {
      const d = (i / 9) ** 2,
        x = w * (0.5 + side * (0.09 + d * 0.56)),
        y = h * (0.445 + d * 0.55),
        pole = h * (0.025 + d * 0.32);
      line(ctx, x, y, x, y - pole, '#63807890', 1 + d);
      line(ctx, x, y - pole, x - side * pole * 0.22, y - pole - 3, '#759087c0', 1.5);
      ctx.fillStyle = '#d5e4b9';
      ctx.fillRect(x - side * pole * 0.22 - 2, y - pole - 4, 4, 2);
      const halo = ctx.createRadialGradient(
        x - side * pole * 0.22,
        y - pole,
        0,
        x - side * pole * 0.22,
        y - pole,
        12,
      );
      halo.addColorStop(0, '#e3edc622');
      halo.addColorStop(1, '#e3edc600');
      ctx.fillStyle = halo;
      ctx.fillRect(x - 20, y - pole - 20, 40, 40);
    }
  const visible = props.targets
    .filter((t) => t.camera)
    .sort((a, b) => (b.fusion?.y ?? 0) - (a.fusion?.y ?? 0));
  for (const target of visible) {
    const [nx, ny, nw, nh] = target.camera!.bbox,
      x = nx * w,
      y = ny * h,
      bw = nw * w,
      bh = nh * h;
    const truck = target.camera!.class === 'truck';
    ctx.fillStyle = '#00000050';
    ctx.beginPath();
    ctx.ellipse(x + bw / 2, y + bh + 4, bw * 0.66, bh * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(x, 0, x + bw, 0);
    body.addColorStop(0, '#28383e');
    body.addColorStop(0.4, truck ? '#a1a69d' : '#71878b');
    body.addColorStop(1, '#2a3c42');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x + bw * 0.17, y);
    ctx.lineTo(x + bw * 0.83, y);
    ctx.lineTo(x + bw, y + bh * (truck ? 0.15 : 0.52));
    ctx.lineTo(x + bw * 0.95, y + bh);
    ctx.lineTo(x + bw * 0.05, y + bh);
    ctx.lineTo(x, y + bh * 0.52);
    ctx.closePath();
    ctx.fill();
    if (truck) {
      ctx.strokeStyle = '#d3d9c650';
      ctx.strokeRect(x + bw * 0.11, y + 2, bw * 0.78, bh * 0.84);
      line(ctx, x + bw / 2, y, x + bw / 2, y + bh * 0.86, '#34484490');
    } else {
      ctx.fillStyle = '#14272e';
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.23, y + bh * 0.08);
      ctx.lineTo(x + bw * 0.77, y + bh * 0.08);
      ctx.lineTo(x + bw * 0.88, y + bh * 0.43);
      ctx.lineTo(x + bw * 0.12, y + bh * 0.43);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#d89b7a';
    ctx.fillRect(x + bw * 0.08, y + bh * 0.68, bw * 0.19, Math.max(2, bh * 0.07));
    ctx.fillRect(x + bw * 0.73, y + bh * 0.68, bw * 0.19, Math.max(2, bh * 0.07));
    ctx.fillStyle = '#c7d8cd';
    ctx.fillRect(x + bw * 0.39, y + bh * 0.81, bw * 0.22, bh * 0.07);
    ctx.fillStyle = '#0c171c';
    ctx.fillRect(x + bw * 0.05, y + bh * 0.93, bw * 0.13, bh * 0.12);
    ctx.fillRect(x + bw * 0.82, y + bh * 0.93, bw * 0.13, bh * 0.12);
  }
  const vignette = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.1, w / 2, h / 2, w * 0.63);
  vignette.addColorStop(0, '#020b0e00');
  vignette.addColorStop(1, '#020b0e80');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}
useCanvas(canvas, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  if (store.videoSource.type === 'mock') drawScene(ctx, w, h);
  else {
    ctx.fillStyle = '#071512';
    ctx.fillRect(0, 0, w, h);
    const source = store.videoSource.type === 'carla' ? carlaImage : video.value;
    if (source && videoReady.value) {
      const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width,
        sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
      const ratio = Math.min(w / sw, h / sh);
      ctx.drawImage(source, (w - sw * ratio) / 2, (h - sh * ratio) / 2, sw * ratio, sh * ratio);
    } else
      label(ctx, sourceError.value || '正在等待视频帧…', w / 2, h / 2, '#8aafa1', 15, 'center');
  }
  hits = [];
  // 视频采用 contain，检测框使用同一 letterbox 变换，避免拉伸和错位。
  let ox = 0,
    oy = 0,
    vw = w,
    vh = h;
  if (store.videoSource.type !== 'mock' && videoReady.value) {
    const sw = store.videoSource.type === 'carla' ? carlaImage?.width : video.value?.videoWidth,
      sh = store.videoSource.type === 'carla' ? carlaImage?.height : video.value?.videoHeight;
    if (sw && sh) {
      const ratio = Math.min(w / sw, h / sh);
      vw = sw * ratio;
      vh = sh * ratio;
      ox = (w - vw) / 2;
      oy = (h - vh) / 2;
    }
  }
  for (const target of props.targets) {
    if (!target.camera || (store.videoSource.type !== 'mock' && !videoReady.value)) continue;
    const [nx, ny, nw, nh] = target.camera.bbox,
      x = ox + nx * vw - 4,
      y = oy + ny * vh - 5,
      bw = nw * vw + 8,
      bh = nh * vh + 10;
    if (x + bw < 0 || x > w || y > h || y + bh < 0) continue;
    const selected = store.selectedId === target.id,
      color = targetColor(target, selected);
    hits.push({ id: target.id, x, y, w: bw, h: bh });
    ctx.strokeStyle = `${color}${selected ? 'c0' : '60'}`;
    ctx.lineWidth = 0.8;
    ctx.setLineDash(target.radar ? [] : [4, 3]);
    ctx.strokeRect(x, y, bw, bh);
    ctx.setLineDash([]);
    const k = Math.min(13, bw / 3);
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + bw, y, -1, 1],
      [x, y + bh, 1, -1],
      [x + bw, y + bh, -1, -1],
    ]) {
      line(ctx, cx, cy, cx + dx * k, cy, color, selected ? 2 : 1.3);
      line(ctx, cx, cy, cx, cy + dy * k, color, selected ? 2 : 1.3);
    }
    const text = `${target.id}  ${target.camera.confidence.toFixed(2)}`,
      tx = Math.min(w - 99, Math.max(3, x));
    ctx.fillStyle = selected ? '#b9f4d9' : '#081c18de';
    ctx.fillRect(tx, y - 22, 95, 19);
    label(ctx, text, tx + 5, y - 9, selected ? '#123b2a' : color, 11);
    if (selected) {
      label(ctx, 'FUSED TRACK', tx, y + bh + 17, '#d3fbe7', 10);
    }
  }
  // 光学中心及细扫描纹理。
  line(ctx, w / 2 - 9, h / 2, w / 2 - 3, h / 2, '#b5d9c43b');
  line(ctx, w / 2 + 3, h / 2, w / 2 + 9, h / 2, '#b5d9c43b');
  line(ctx, w / 2, h / 2 - 9, w / 2, h / 2 - 3, '#b5d9c43b');
  for (let y = 0; y < h; y += 4) {
    ctx.fillStyle = '#06150d0b';
    ctx.fillRect(0, y, w, 1);
  }
});
function select(event: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect(),
    x = ((event.clientX - rect.left) / rect.width) * canvas.value!.clientWidth,
    y = ((event.clientY - rect.top) / rect.height) * canvas.value!.clientHeight;
  const hit = [...hits]
    .reverse()
    .find((p) => x >= p.x && x <= p.x + p.w && y >= p.y - 22 && y <= p.y + p.h);
  if (hit) store.select(hit.id);
  if (store.videoSource.type === 'video' && store.playing && video.value?.paused)
    void video.value.play().catch(() => {});
}
</script>
<template>
  <section class="hud-panel camera-panel">
    <PanelHeader
      index="02"
      title="视觉感知"
      english="CAMERA VIEW"
      :status="
        store.videoSource.type === 'mock'
          ? '模拟图像 · Canvas'
          : videoReady
            ? '图像流已连接'
            : '等待图像流'
      "
    />
    <div class="camera-body">
      <div class="canvas-wrap camera-canvas">
        <video
          v-if="store.videoSource.type === 'video'"
          ref="video"
          :src="store.videoSource.url"
          muted
          playsinline
          loop
          preload="auto"
          class="video-decoder"
          @loadeddata="onVideoReady"
          @error="sourceError = '视频无法加载，请检查地址与格式'"
        ></video
        ><canvas
          ref="canvas"
          :data-selected-target="store.selectedId"
          @click="select"
          aria-label="视觉检测画面，点击检测框可选中目标"
        ></canvas>
        <div class="camera-topline">
          <span
            ><i class="dot green"></i
            >{{ store.videoSource.type === 'mock' ? 'SIMULATED' : 'LIVE INPUT' }}</span
          ><span>CAM 01 · FRONT</span>
        </div>
        <div class="camera-bottomline">
          <span
            >{{
              store.videoSource.type === 'mock'
                ? 'PROCEDURAL SCENE'
                : store.videoSource.type.toUpperCase()
            }}
            / DETECTION OVERLAY</span
          ><span>{{ store.frame.timestamp.toFixed(0).padStart(8, '0') }}</span>
        </div>
        <div v-if="store.selected && !store.selected.camera" class="out-of-view">
          {{ store.selected.id }} · 仅雷达目标 / 无视觉观测
        </div>
        <div v-if="sourceError && !sourceDialog" class="source-error">{{ sourceError }}</div>
      </div>
      <aside class="target-sidebar">
        <div class="eyebrow">INPUT SOURCE</div>
        <div class="source-tabs">
          <button
            v-for="type in ['mock', 'video', 'carla'] as const"
            :key="type"
            :class="{ active: store.videoSource.type === type }"
            @click="openSource(type)"
          >
            {{ type.toUpperCase() }}
          </button>
        </div>
        <div class="side-divider"></div>
        <div class="target-title">
          <h3>锁定目标</h3>
          <span class="tiny-badge">TRACKING</span>
        </div>
        <div class="selected-id">
          {{ store.selectedId
          }}<span>{{
            store.selected?.radar && store.selected?.camera
              ? '已融合'
              : store.selected?.radar
                ? '仅雷达'
                : '仅视觉'
          }}</span>
        </div>
        <dl v-if="store.selected" class="data-list target-data">
          <div>
            <dt>方位角 / N</dt>
            <dd>{{ store.selected.fusion?.azimuth.toFixed(1) ?? '—' }}<small> °</small></dd>
          </div>
          <div>
            <dt>径向速度</dt>
            <dd>
              {{ store.selected.fusion?.radialVelocity?.toFixed(2) ?? '—' }}<small> m/s</small>
            </dd>
          </div>
          <div>
            <dt>切向速度</dt>
            <dd>
              {{ store.selected.fusion?.tangentialVelocity?.toFixed(2) ?? '—' }}<small> m/s</small>
            </dd>
          </div>
          <div>
            <dt>目标类别</dt>
            <dd>{{ store.selected.camera?.class.toUpperCase() ?? 'UNKNOWN' }}</dd>
          </div>
          <div>
            <dt>视觉置信度</dt>
            <dd>
              {{
                store.selected.camera
                  ? (store.selected.camera.confidence * 100).toFixed(1) + '%'
                  : '—'
              }}
            </dd>
          </div>
        </dl>
        <div class="confidence-bar">
          <i :style="{ width: `${(store.selected?.camera?.confidence ?? 0) * 100}%` }"></i>
        </div>
        <div class="risk-readout">
          <span>目标风险值</span
          ><b :class="{ warm: (store.selected?.risk?.value ?? 0) >= 0.75 }">{{
            store.selected?.risk?.value.toFixed(2) ?? '—'
          }}</b
          ><small>RELATIVE RISK</small>
        </div>
      </aside>
    </div>
    <div v-if="sourceDialog" class="dialog-backdrop" @click.self="sourceDialog = false">
      <form class="source-dialog" @submit.prevent="applySource">
        <div class="eyebrow">EXTERNAL VIDEO SOURCE</div>
        <h3>{{ sourceType === 'carla' ? '连接 CARLA 图像流' : '接入视频源' }}</h3>
        <p>
          {{
            sourceType === 'carla'
              ? '输入发送 JPEG / PNG 二进制帧的 WebSocket 地址。'
              : '输入浏览器支持的 MP4 / WebM 地址。检测数据由统一接口提供。'
          }}
        </p>
        <input
          v-model="sourceUrl"
          required
          :placeholder="
            sourceType === 'carla'
              ? 'ws://localhost:8765/camera'
              : 'http://localhost:8000/drive.mp4'
          "
          aria-label="视频源地址"
          autofocus
        />
        <p v-if="sourceError" class="warm">{{ sourceError }}</p>
        <div class="dialog-actions">
          <button type="button" @click="sourceDialog = false">取消</button
          ><button type="submit" class="primary-button">连接画面</button>
        </div>
      </form>
    </div>
  </section>
</template>
