<template>
  <div class="team-page">
    <header class="page-head">
      <h1>团队分工与工程里程碑推进表</h1>
      <p>基于桌面端 C# WinForms 基线 v0.3.6，前后端通过 Transport 契约并行开发与验收</p>
    </header>

    <div class="team-grid">
      <CardPanel title="前端架构与可视化工程师（本人）">
        <p class="role-tag">负责模块：Web 版上位机全栈前端 + 作品官网 + Canvas 2D 可视化引擎</p>
        <ul class="task-list">
          <li>构建 Vue 3 + TypeScript + Pinia + 自建轻量 UI 组件体系（零第三方 UI 库依赖）</li>
          <li>实现 60fps 雷达辉光散点图、等比不裁剪视觉检测框叠加、41×13 相对风险场热图</li>
          <li>设计并实现 <code>Transport</code> 抽象层与三大高保真模拟器（<code>radarSim</code> / <code>visionSim</code> / <code>fusionSim</code>）</li>
          <li>严格落实桌面端 v0.3.6 诚实性边界文案与 <code>ok / expired / uncalibrated</code> 三态门控可视化</li>
        </ul>
      </CardPanel>

      <CardPanel title="后端与上位机底座工程师（队友 A）">
        <p class="role-tag">负责模块：TCR300 雷达通信协议 + 会话录制回放 + WebSocket 流服务</p>
        <ul class="task-list">
          <li>维护 C# WinForms 桌面端基线 <code>RadarResearchHost_DevHandoff_v0.3.6</code></li>
          <li>实现 TCP 50000 雷达报文解析、二进制落盘 (<code>raw.bin</code> / <code>raw-index.csv</code>) 与回放状态机</li>
          <li>提供 <code>/api/radar/*</code> 与 <code>WS /api/stream</code> 实时推送接口</li>
        </ul>
      </CardPanel>

      <CardPanel title="视觉感知与融合算法工程师（队友 B）">
        <p class="role-tag">负责模块：多源人车检测推理 + 地面单应标定 + 相对风险场建模</p>
        <ul class="task-list">
          <li>负责 6 类道路目标实时检测与 <code>schema_version=2</code> 采样落盘</li>
          <li>实现 4 点地面单应性矩阵求解与标定区内外掩码判定</li>
          <li>构建车辆 4.5×1.8m 先验各向异性高斯核与人车接近关系 (TTC / 最近距离) 计算</li>
        </ul>
      </CardPanel>
    </div>

    <CardPanel title="M0 ~ M8 阶段里程碑与验收状态">
      <div class="milestone-list">
        <div v-for="m in milestones" :key="m.code" class="m-row">
          <div class="m-code">{{ m.code }}</div>
          <div class="m-info">
            <div class="m-top">
              <strong>{{ m.title }}</strong>
              <StatusBadge :tone="m.done ? 'ok' : 'warn'">{{ m.status }}</StatusBadge>
            </div>
            <p class="m-desc">{{ m.criteria }}</p>
            <div class="m-bar-bg">
              <div class="m-bar-fill" :style="{ width: `${m.progress}%` }" />
            </div>
          </div>
        </div>
      </div>
    </CardPanel>
  </div>
</template>

<script setup lang="ts">
import CardPanel from '@/components/ui/CardPanel.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';

const milestones = [
  { code: 'M0', title: '脚手架与设计令牌', criteria: 'Vite+Vue3+TS+Router+Pinia，tokens.css，AppShell，路由可达', progress: 100, done: true, status: '已通过' },
  { code: 'M1', title: '轻量设计系统与官网首页', criteria: '自建 UI 组件 + 首页在 1366/1920 无横向滚动', progress: 100, done: true, status: '已通过' },
  { code: 'M2', title: '数据层与三路模拟器', criteria: 'Transport 接口 + 2s 内 ≥10 批目标、过期目标自动移除单测通过', progress: 100, done: true, status: '已通过' },
  { code: 'M3', title: '雷达采集页 (/console/radar)', criteria: '连接卡/动作条/60fps 散点/128 行上限表格/日志截断/状态条', progress: 100, done: true, status: '已通过' },
  { code: 'M4', title: '人车视觉页 (/console/vision)', criteria: '四种来源提示切换、置信度实时过滤检测框、指标条同步', progress: 100, done: true, status: '已通过' },
  { code: 'M5', title: '融合与风险场页 (/console/fusion)', criteria: 'ok/expired/uncalibrated 三态可辨、displayField=null 零热图像素、CSV 导出模态框', progress: 100, done: true, status: '已通过' },
  { code: 'M6', title: '作品官网四页 (/tech /demo /data /team)', criteria: 'DataPage 字段表与 §5.1 一致、Demo 页三态一键切换', progress: 100, done: true, status: '已通过' },
  { code: 'M7', title: '全局无障碍与色彩合规打磨', criteria: '零硬编码颜色、全部控件具备 focus 样式与 aria-label', progress: 100, done: true, status: '已通过' },
  { code: 'M8', title: 'HttpTransport 联调接口契约', criteria: '支持 VITE_DATA_MODE=http 零组件改动切换与断线自动回退 Mock', progress: 100, done: true, status: '契约就绪' }
];
</script>

<style scoped>
.team-page {
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
}

.page-head p {
  font-size: var(--fs-body);
  color: var(--c-ink-2);
  margin-top: var(--sp-1);
}

.team-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-4);
}

.role-tag {
  font-size: var(--fs-cap);
  font-weight: 700;
  color: var(--c-ok);
  background: var(--c-ok-soft);
  padding: 4px 8px;
  border-radius: var(--r-sm);
  margin-bottom: var(--sp-2);
}

.task-list {
  padding-left: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-cap);
  color: var(--c-ink);
  line-height: 1.55;
}

.milestone-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.m-row {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: var(--sp-3);
  align-items: center;
}

.m-code {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-canvas);
  color: var(--c-teal);
  font-family: var(--font-mono);
  font-weight: 700;
  border-radius: var(--r-sm);
}

.m-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.m-desc {
  font-size: var(--fs-xs);
  color: var(--c-ink-2);
  margin-bottom: 6px;
}

.m-bar-bg {
  height: 6px;
  background: var(--c-head);
  border-radius: 999px;
  overflow: hidden;
}

.m-bar-fill {
  height: 100%;
  background: var(--c-ok);
}
</style>
