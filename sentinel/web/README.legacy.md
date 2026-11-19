# 雷达研究上位机 v0.3.6 — 竞赛前端工程 (Web)

> 1:1 复刻桌面端 `RadarResearchHost_DevHandoff_v0.3.6_2026-10-13`，包含 **作品官网（5 页叙事）** 与 **Web 版上位机（3 大实时可视化工作台）**。

## 1. 快速启动

```bash
cd web
npm install
npm run dev       # 启动开发服务器
npm run typecheck # 运行 vue-tsc 类型检查
npm run test      # 运行 vitest 数据层与模拟器单测
npm run build     # 构建生产产物
npm run preview   # 预览生产构建
```

## 2. 路由与模块清单

- **A. 作品官网**：
  - `/`：首页（深蓝科技 Hero + 60fps 散点背景动效 + 核心指标卡 + 模块导览）
  - `/tech`：技术架构（四层感知融合 SVG 架构图 + `Transport` 接口解耦说明）
  - `/demo`：交互演示台（支持内嵌切换三大工作台与 `?demo=ok|expired|uncalibrated` 一键切换）
  - `/data`：数据说明与诚实边界（落盘文件字典、`src/types/index.ts` 字段表、时间边界约定与风险声明原文）
  - `/team`：成员分工与 M0~M8 里程碑进度
- **B. Web 版上位机**：
  - `/console/radar`：雷达采集页（TCR300 连接/断开/回放、60fps 辉光散点图、128 行上限目标事件表、自动截断运行日志、底部状态栏）
  - `/console/vision`：人车视觉页（RTSP/摄像头/本地视频/本地图片、等比不裁剪检测框叠加、置信度滑块实时过滤、采样上限与指标条）
  - `/console/fusion`：融合与风险场页（4 点地面单应标定、41×13 各向异性相对风险场热图、标定框显隐、TTC 接近关系虚线、质量门控状态卡、研究 CSV 导出模态框）

## 3. 数据层切换（Mock → 真实后端 API）

默认使用 `MockTransport`（无需后端即可完整交互）。当队友后端接口就绪后，设置环境变量：

```bash
VITE_DATA_MODE=http npm run dev
```

即可零业务组件改动切换至 `HttpTransport`。
