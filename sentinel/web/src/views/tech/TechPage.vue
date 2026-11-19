<template>
  <div class="tech-page">
    <header class="page-head">
      <h1>系统技术架构与数据层解耦设计</h1>
      <p>从多源传感器接入、时空对齐融合核到前端 Transport 抽象接口的完整工程链路</p>
    </header>

    <!-- SVG 手绘分层架构图 -->
    <CardPanel title="多源感知与相对风险场四层架构图">
      <div class="svg-container">
        <svg viewBox="0 0 960 280" class="arch-svg" role="img" aria-label="系统四层架构图">
          <!-- Layer 1: Sensors -->
          <rect x="20" y="30" width="190" height="95" rx="8" class="box-sensor" />
          <text x="115" y="65" text-anchor="middle" class="svg-title">TCR300 77GHz 毫米波雷达</text>
          <text x="115" y="88" text-anchor="middle" class="svg-sub">TCP 50000 · 10Hz 目标流</text>
          <text x="115" y="108" text-anchor="middle" class="svg-sub">X/Y/Vx/Vy/RCS/SNR</text>

          <rect x="20" y="155" width="190" height="95" rx="8" class="box-sensor" />
          <text x="115" y="190" text-anchor="middle" class="svg-title">道路视觉摄像机 / RTSP</text>
          <text x="115" y="213" text-anchor="middle" class="svg-sub">本机 / OBS / 离线视频帧</text>
          <text x="115" y="233" text-anchor="middle" class="svg-sub">6 类人车目标检测框</text>

          <!-- Arrows 1->2 -->
          <line x1="210" y1="78" x2="270" y2="78" class="svg-arrow" />
          <line x1="210" y1="202" x2="270" y2="202" class="svg-arrow" />

          <!-- Layer 2: Ingestion & Calibration -->
          <rect x="270" y="30" width="210" height="220" rx="8" class="box-core" />
          <text x="375" y="65" text-anchor="middle" class="svg-title">采集录制与时空对齐层</text>
          <text x="375" y="95" text-anchor="middle" class="svg-sub">· 2000ms 雷达目标活性窗</text>
          <text x="375" y="120" text-anchor="middle" class="svg-sub">· 4 点地面单应性矩阵标定</text>
          <text x="375" y="145" text-anchor="middle" class="svg-sub">· 对齐容差与相机时间偏移修正</text>
          <text x="375" y="170" text-anchor="middle" class="svg-sub">· 独立会话落盘 (raw/csv/jsonl)</text>
          <text x="375" y="205" text-anchor="middle" class="svg-badge">质量门控：ok / expired / uncalibrated</text>

          <!-- Arrow 2->3 -->
          <line x1="480" y1="140" x2="540" y2="140" class="svg-arrow" />

          <!-- Layer 3: Anisotropic Risk Field -->
          <rect x="540" y="30" width="190" height="220" rx="8" class="box-core" />
          <text x="635" y="65" text-anchor="middle" class="svg-title">各向异性相对风险场</text>
          <text x="635" y="95" text-anchor="middle" class="svg-sub">· 41×13 米制网格 (-20~20, 0~60m)</text>
          <text x="635" y="120" text-anchor="middle" class="svg-sub">· 车辆 4.5×1.8m 先验高斯核</text>
          <text x="635" y="145" text-anchor="middle" class="svg-sub">· 纵向 β=0.20 · 横向 β=0.50</text>
          <text x="635" y="170" text-anchor="middle" class="svg-sub">· 归一化强度 raw / (1 + raw)</text>
          <text x="635" y="205" text-anchor="middle" class="svg-badge">非事故概率 · 探索性相对强度</text>

          <!-- Arrow 3->4 -->
          <line x1="730" y1="140" x2="780" y2="140" class="svg-arrow" />

          <!-- Layer 4: Vue3 Frontend -->
          <rect x="780" y="30" width="160" height="220" rx="8" class="box-ui" />
          <text x="860" y="65" text-anchor="middle" class="svg-title">Vue 3 + TS 上位机</text>
          <text x="860" y="95" text-anchor="middle" class="svg-sub">· Transport 抽象接口</text>
          <text x="860" y="120" text-anchor="middle" class="svg-sub">· Mock / Http 零改动切换</text>
          <text x="860" y="145" text-anchor="middle" class="svg-sub">· rAF 60fps Canvas 自绘</text>
          <text x="860" y="170" text-anchor="middle" class="svg-sub">· 统一世界↔屏幕坐标变换</text>
        </svg>
      </div>
    </CardPanel>

    <div class="tech-grid">
      <CardPanel title="前端数据层契约：MockTransport → HttpTransport 零改动切换">
        <p class="tech-p">
          所有业务页面（<code>RadarPage</code>、<code>VisionPage</code>、<code>FusionPage</code>）与 Pinia 状态仓库仅依赖
          <code>src/data/transport.ts</code> 暴露的 <code>Transport</code> 接口。
        </p>
        <ul class="tech-list">
          <li><strong>默认模式 (VITE_DATA_MODE=mock)</strong>：注入内置模拟引擎（<code>radarSim</code> + <code>visionSim</code> + <code>fusionSim</code>），完整复刻 2 秒目标过期剔除、置信度过滤与 41×13 各向异性风险场。</li>
          <li><strong>后端联调模式 (VITE_DATA_MODE=http)</strong>：注入 <code>HttpTransport</code>，自动对接 REST 控制端点与 <code>WS /api/stream</code> 实时流，异常时具备优雅降级保护。</li>
        </ul>
      </CardPanel>

      <CardPanel title="高性能 Canvas 2D 渲染与统一坐标数学">
        <p class="tech-p">
          高频目标散点与 41×13 风险热图完全脱离 DOM 重排，由 <code>RafScheduler</code> 在 <code>requestAnimationFrame</code> 周期内合批绘制：
        </p>
        <ul class="tech-list">
          <li><strong>统一坐标变换 (src/utils/coords.ts)</strong>：雷达散点与融合俯视图共享 <code>worldToScreen</code> 与 <code>screenToWorld</code>，支持 0.5×~6.0× 滚轮定点缩放、左键拖拽平移与双击复位。</li>
          <li><strong>诚实绘制原则</strong>：当 <code>displayField === null</code> 或结果超时过期时，画布绝不填充伪造 0 值，直接清空热图并显式呈报门控原因。</li>
        </ul>
      </CardPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import CardPanel from '@/components/ui/CardPanel.vue';
</script>

<style scoped>
.tech-page {
  max-width: 1320px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.page-head h1 {
  font-size: var(--fs-title);
  font-weight: 800;
  color: var(--c-ink);
}

.page-head p {
  font-size: var(--fs-body);
  color: var(--c-ink-2);
  margin-top: var(--sp-1);
}

.svg-container {
  background: var(--c-canvas);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  overflow-x: auto;
}

.arch-svg {
  width: 100%;
  height: auto;
  min-width: 780px;
}

.box-sensor {
  fill: var(--c-hero-end);
  stroke: var(--c-teal);
  stroke-width: 1.5;
}

.box-core {
  fill: var(--c-hero-end);
  stroke: var(--c-axis);
  stroke-width: 1.5;
}

.box-ui {
  fill: var(--c-hero-end);
  stroke: var(--c-amber);
  stroke-width: 1.5;
}

.svg-title {
  fill: var(--c-surface);
  font-size: 13px;
  font-weight: 700;
}

.svg-sub {
  fill: var(--c-ink-3);
  font-size: 11px;
}

.svg-badge {
  fill: var(--c-teal);
  font-size: 11px;
  font-weight: 600;
}

.svg-arrow {
  stroke: var(--c-teal);
  stroke-width: 2;
  stroke-dasharray: 4 3;
}

.tech-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
}

.tech-p {
  font-size: var(--fs-body);
  color: var(--c-ink-2);
  margin-bottom: var(--sp-2);
  line-height: 1.6;
}

.tech-list {
  padding-left: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-cap);
  color: var(--c-ink);
  line-height: 1.55;
}
</style>
