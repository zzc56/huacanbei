<template>
  <div class="home-page">
    <!-- Hero Section -->
    <section class="hero-section">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-badge">{{ COPY.PROTOTYPE_BADGE }}</div>
          <h1 class="hero-title">摄像头 · 雷达 · 风险场</h1>
          <p class="hero-sub">多源感知融合研究原型 · 竞赛作品演示</p>
          <p class="hero-desc">
            1:1 复刻桌面端 C# WinForms 雷达研究上位机 v0.3.6，支持 TCR300 毫米波雷达实时散点、道路人车视觉检测框叠加、地面单应性标定与各向异性相对风险场可视化。
          </p>
          <div class="hero-ctas">
            <RouterLink to="/tech" class="btn-outline">查看技术架构</RouterLink>
            <RouterLink to="/console/radar" class="btn-solid">进入演示系统</RouterLink>
          </div>
        </div>
        <div class="hero-visual">
          <div class="hero-plot-card">
            <div class="plot-tag">实时毫米波散点预览 · 60fps Canvas 自绘</div>
            <div class="plot-box">
              <RadarScatterPlot
                :targets="demoTargets"
                :half-width="20"
                :max-length="100"
                :interactive="false"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 四个数字指标卡 -->
    <section class="metrics-section">
      <div class="metric-card">
        <span class="m-label">实验采集会话数</span>
        <strong class="m-value tabular-nums">{{ animatedSessions }}</strong>
        <span class="m-note">含实测回放与合成自检基线</span>
      </div>
      <div class="metric-card">
        <span class="m-label">累计目标事件数</span>
        <strong class="m-value tabular-nums">{{ animatedTargets.toLocaleString() }}</strong>
        <span class="m-note">TCR300 报文解析记录</span>
      </div>
      <div class="metric-card">
        <span class="m-label">视觉检测类别</span>
        <strong class="m-value tabular-nums">6</strong>
        <span class="m-note">person / bicycle / car / motorcycle / bus / truck</span>
      </div>
      <div class="metric-card">
        <span class="m-label">融合风险场网格</span>
        <strong class="m-value tabular-nums">41×13</strong>
        <span class="m-note">X ±20m · Y 0~60m · 1m 分辨率</span>
      </div>
    </section>

    <!-- 三大核心模块介绍卡 -->
    <section class="modules-section">
      <h2 class="section-title">上位机三大核心工作台（1:1 复刻桌面端 v0.3.6）</h2>
      <div class="modules-grid">
        <CardPanel title="01 · 雷达采集 (/console/radar)">
          <p class="mod-desc">
            支持 TCR300 雷达 TCP 连接、会话录制与离线回放。左侧深色散点图呈现 2 秒内活跃目标辉光轨迹，右侧提供最多 128 行目标事件表与自动截断运行日志。
          </p>
          <div class="mod-meta">
            <span>散点 60fps</span>
            <span>滚轮缩放 / 拖拽平移 / 双击复位</span>
          </div>
          <RouterLink to="/console/radar" class="mod-link">打开雷达采集页 →</RouterLink>
        </CardPanel>

        <CardPanel title="02 · 人车视觉 (/console/vision)">
          <p class="mod-desc">
            支持 RTSP、本机/OBS 摄像头及本地离线音视频素材。等比不裁剪渲染道路画面与类别检测框（行人青绿框、车辆天蓝框），支持置信度阈值与采样上限实时联动。
          </p>
          <div class="mod-meta">
            <span>schema_version=2</span>
            <span>置信度 0.05~0.95 实时过滤</span>
          </div>
          <RouterLink to="/console/vision" class="mod-link">打开人车视觉页 →</RouterLink>
        </CardPanel>

        <CardPanel title="03 · 融合与风险场 (/console/fusion)">
          <p class="mod-desc">
            基于 4 点地面单应性标定将视觉行人投影至米制俯视图，结合车辆 4.5×1.8m 先验各向异性高斯核绘制相对风险热图，具备显式过期隐藏与未标定门控提示。
          </p>
          <div class="mod-meta">
            <span>ok / expired / uncalibrated 三态可切</span>
            <span>研究 CSV 三表导出</span>
          </div>
          <RouterLink to="/console/fusion" class="mod-link">打开融合与风险场页 →</RouterLink>
        </CardPanel>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { COPY, type RadarTarget } from '@/types';
import { RadarSimulator } from '@/data/mock/radarSim';
import CardPanel from '@/components/ui/CardPanel.vue';
import RadarScatterPlot from '@/components/charts/RadarScatterPlot.vue';

const sim = new RadarSimulator('busy');
const demoTargets = ref<RadarTarget[]>(sim.getActiveTargets());
const animatedSessions = ref(0);
const animatedTargets = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // Number roll-up animation
  const targetSessions = 18;
  const targetEvents = 42860;
  let step = 0;
  const roll = setInterval(() => {
    step += 1;
    const progress = Math.min(1, step / 20);
    animatedSessions.value = Math.round(targetSessions * progress);
    animatedTargets.value = Math.round(targetEvents * progress);
    if (progress >= 1) clearInterval(roll);
  }, 30);

  timer = setInterval(() => {
    sim.stepBatch(Date.now());
    demoTargets.value = sim.getActiveTargets(Date.now(), 2000);
  }, 150);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  padding-bottom: var(--sp-6);
}

.hero-section {
  background: linear-gradient(135deg, var(--c-canvas) 0%, var(--c-hero-end) 100%);
  color: var(--c-surface);
  padding: var(--sp-6) var(--sp-4);
  border-bottom: 1px solid var(--c-grid);
}

.hero-inner {
  max-width: 1320px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: var(--sp-5);
  align-items: center;
}

.hero-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(68, 201, 190, 0.16);
  border: 1px solid var(--c-teal);
  color: var(--c-teal);
  font-size: var(--fs-cap);
  font-weight: 600;
  margin-bottom: var(--sp-3);
}

.hero-title {
  font-size: var(--fs-hero);
  font-weight: 800;
  letter-spacing: 0.5px;
  margin-bottom: var(--sp-2);
}

.hero-sub {
  font-size: var(--fs-title);
  color: var(--c-ink-3);
  font-weight: 600;
  margin-bottom: var(--sp-3);
}

.hero-desc {
  font-size: var(--fs-body);
  color: var(--c-ink-3);
  line-height: 1.65;
  margin-bottom: var(--sp-5);
}

.hero-ctas {
  display: flex;
  gap: var(--sp-3);
}

.btn-solid,
.btn-outline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 var(--sp-5);
  border-radius: var(--r-sm);
  font-weight: 700;
  text-decoration: none;
  transition: all 0.15s ease;
}

.btn-solid {
  background: var(--c-teal);
  color: var(--c-canvas);
}

.btn-outline {
  border: 1px solid var(--c-ink-3);
  color: var(--c-surface);
}

.btn-outline:hover {
  border-color: var(--c-teal);
  color: var(--c-teal);
}

.hero-plot-card {
  background: rgba(11, 19, 32, 0.72);
  border: 1px solid var(--c-grid);
  border-radius: var(--r-md);
  padding: var(--sp-2);
  box-shadow: var(--shadow-elevated);
}

.plot-tag {
  font-size: var(--fs-xs);
  color: var(--c-ink-3);
  margin-bottom: var(--sp-1);
  padding: 0 var(--sp-1);
}

.plot-box {
  height: 340px;
}

.metrics-section {
  max-width: 1320px;
  width: 100%;
  margin: 0 auto;
  padding: 0 var(--sp-4);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-4);
}

.metric-card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.m-label {
  font-size: var(--fs-cap);
  color: var(--c-ink-2);
  font-weight: 600;
}

.m-value {
  font-size: 28px;
  color: var(--c-ink);
  font-weight: 800;
}

.m-note {
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
}

.modules-section {
  max-width: 1320px;
  width: 100%;
  margin: 0 auto;
  padding: 0 var(--sp-4);
}

.section-title {
  font-size: var(--fs-title);
  font-weight: 700;
  margin-bottom: var(--sp-4);
  color: var(--c-ink);
}

.modules-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-4);
}

.mod-desc {
  font-size: var(--fs-body);
  color: var(--c-ink-2);
  line-height: 1.6;
  margin-bottom: var(--sp-3);
}

.mod-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
  font-size: var(--fs-xs);
  color: var(--c-ok);
}

.mod-meta span {
  background: var(--c-ok-soft);
  padding: 2px 8px;
  border-radius: var(--r-sm);
}

.mod-link {
  display: inline-block;
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ink);
  text-decoration: none;
}

.mod-link:hover {
  color: var(--c-teal-dark);
}
</style>
