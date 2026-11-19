<template>
  <div class="data-page">
    <header class="page-head">
      <h1>数据契约、落盘文件规范与诚实性边界声明</h1>
      <p class="honesty-highlight">{{ COPY.DATA_PAGE_BOUNDARY }}</p>
    </header>

    <!-- 1. 实验落盘文件说明 -->
    <CardPanel title="采集与融合实验文件夹落盘结构">
      <table class="spec-table">
        <thead>
          <tr>
            <th>文件名</th>
            <th>所属模块</th>
            <th>格式与内容说明</th>
            <th>诚实性约束与边界</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="mono">raw.bin</td>
            <td>雷达采集</td>
            <td>TCR300 雷达 TCP 原始字节流追加写入</td>
            <td>未经上位机二次修改，用于算法重放复现</td>
          </tr>
          <tr>
            <td class="mono">raw-index.csv</td>
            <td>雷达采集</td>
            <td>每个网络接收块在 raw.bin 中的字节偏移、长度与主机接收 UTC</td>
            <td>记录主机网卡到达时刻，非雷达硬件 PPS 时间戳</td>
          </tr>
          <tr>
            <td class="mono">targets.csv</td>
            <td>雷达采集</td>
            <td>解析后的目标事件表（id, cls, x, y, vx, vy, range, angle, rcs, snr, vendorTime, receiveUtc）</td>
            <td>{{ COPY.TOOLTIP_TARGET_COL }}</td>
          </tr>
          <tr>
            <td class="mono">events.jsonl</td>
            <td>系统状态</td>
            <td>连接、断连、标定变更、参数调整与异常事件的结构化日志流</td>
            <td>保留完整代际切换痕迹</td>
          </tr>
          <tr>
            <td class="mono">session.json</td>
            <td>全局元数据</td>
            <td>记录 schema_version=2、雷达 IP/端口、视觉源类型及融合参数快照</td>
            <td>回放时自动校验 schema 版本兼容性</td>
          </tr>
        </tbody>
      </table>
    </CardPanel>

    <!-- 2. 核心领域模型字段表 (§5.1 对照) -->
    <CardPanel title="核心领域数据结构契约 (src/types/index.ts)">
      <table class="spec-table">
        <thead>
          <tr>
            <th>模型接口</th>
            <th>关键字段</th>
            <th>物理含义与单位</th>
            <th>空态 / 异常态诚实处理规则</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="mono">RadarTarget</td>
            <td class="mono">id, cls, x, y, vx, vy, range, angle, velocity, rcs, snr, energy, vendorTime, sequence, receiveUtc</td>
            <td>x/y 单位 m；vx/vy 单位 m/s；vendorTime 为 HH:mm:ss.fff</td>
            <td>超过 2 秒未更新的目标立即从活动视图移除；NaN/Infinity 显式渲染为 —</td>
          </tr>
          <tr>
            <td class="mono">VisionFrame</td>
            <td class="mono">sequence, sourceKind, capturedUtc, width, height, inferenceMs, boxes[], previewDataUrl</td>
            <td>boxes 含归一化 x, y, w, h 与 classId (0|1|2|3|5|7)</td>
            <td>计数仅代表当前帧可见检测框数，非去重交通流统计</td>
          </tr>
          <tr>
            <td class="mono">FusionSnapshot</td>
            <td class="mono">fieldAvailable, calibrationValid, status, displayField, validFieldMask, radarObjects, pedestrians, interactions</td>
            <td>41×13 网格；displayField = raw/(1+raw)</td>
            <td>当不可用或超时 (expired) 时，displayField 严格为 null，严禁填 0 伪装安全</td>
          </tr>
        </tbody>
      </table>
    </CardPanel>

    <!-- 3. 三个时间边界约定与风险声明原文 -->
    <div class="two-col">
      <CardPanel title="三个时间边界约定">
        <ul class="boundary-list">
          <li><strong>vendorTime（主机解析时刻）</strong>：上位机解析报文生成的本地时分秒毫秒字符串，不代表雷达硬件晶振曝光时刻。</li>
          <li><strong>receiveUtc / capturedUtc（主机采集时刻）</strong>：雷达与视觉各自独立采集，融合层通过 <code>alignWindowMs</code>（默认 500ms）与人工 <code>cameraOffsetMs</code> 对齐，非硬件同步触发。</li>
          <li><strong>maxAgeMs（1500ms 融合过期门控）</strong>：一旦任一关键观测流滞后超限，立即触发 <code>status='expired'</code>，隐藏目标与联合风险场。</li>
        </ul>
      </CardPanel>

      <CardPanel title="界面强制保留的边界声明原文">
        <ul class="boundary-list">
          <li><strong>融合页声明</strong>：{{ COPY.FUSION_FOOTER }}</li>
          <li><strong>雷达页声明</strong>：{{ COPY.RADAR_FOOTER }}</li>
          <li><strong>视觉页声明</strong>：{{ COPY.VISION_FOOTER }}</li>
          <li><strong>核心风险定义</strong>：{{ COPY.DATA_PAGE_BOUNDARY }}</li>
        </ul>
      </CardPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { COPY } from '@/types';
import CardPanel from '@/components/ui/CardPanel.vue';
</script>

<style scoped>
.data-page {
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

.honesty-highlight {
  display: inline-block;
  margin-top: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  background: var(--c-warn-soft);
  color: var(--c-warn-ink);
  border: 1px solid var(--c-amber);
  border-radius: var(--r-sm);
  font-weight: 700;
}

.spec-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-cap);
}

.spec-table th {
  background: var(--c-head);
  color: var(--c-ink);
  font-weight: 600;
  padding: var(--sp-2);
  text-align: left;
  border-bottom: 1px solid var(--c-border-strong);
}

.spec-table td {
  padding: var(--sp-2);
  border-bottom: 1px solid var(--c-head);
  vertical-align: top;
}

.spec-table tr:nth-child(even) {
  background: var(--c-row-alt);
}

.mono {
  font-family: var(--font-mono);
  font-weight: 600;
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
}

.boundary-list {
  padding-left: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-cap);
  line-height: 1.6;
}
</style>
