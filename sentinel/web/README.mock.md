# SENTINEL · 多模态融合目标检测系统

Vue 3 + TypeScript + Vite + Pinia + ECharts + Tailwind CSS 的完整前端项目。新版首页为 16:9 冰白青绿监控中枢：左侧展示选中目标、风险、分速度与趋势；右侧默认摄像头感知，可切换雷达探测与二维风险场，并通过目标列表联动选择。画面由 Canvas 程序绘制，无外部图片、字体、图标或后端依赖。

## 快速预览成品

交付包已包含 dist。双击「预览成品.cmd」即可打开，或运行 npm start；本机需安装 Node.js，不必先安装依赖。Ctrl+C 停止。

## 开发启动

推荐 Node.js 22.12+ 或 24 LTS。

```powershell
cd sentinel/web
npm install
npm run dev
```

默认地址 http://localhost:5173/ ，端口占用时 Vite 会选择下一个端口。也可以双击「启动驾驶舱.cmd」。

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

生产产物在 dist/，通过 HTTP 静态服务器运行，不能双击 HTML。压缩包解压后在 web 目录运行相同命令。

## 操作与布局

- 点击任一视图的目标点、检测框、风险场标签，或右侧目标列表，共享选中 ID；切换视图后保持锁定，左侧显示该目标的方位角与分速度。
- 暂停键 / Space：冻结数据时间轴、雷达扫描、车辆、车道与风险场。北京时间继续显示。
- 全屏键 / F：进入和退出全屏；Esc 退出。浏览器拒绝时显示提示。
- 画面左下方可切换等高线与航迹；风险场悬停显示场值。场计算在 Web Worker 中执行，细等高线叠加在浅色城市地图上，高风险核心采用低饱和陶土色。
- 摄像头 MOCK / VIDEO / CARLA 可实际配置图像来源。
- 青绿、灰金、陶土色分别标示低、中、高风险。目标来源另以“已融合 / 仅雷达 / 仅视觉”显示；当前视图没有对应观测时提示原因。
- 摄像头列表按车辆、货车、行人筛选；雷达和风险场列表按风险等级筛选。目标列表滚动后可访问全部目标。
- 风险趋势支持 1 / 10 / 30 分钟窗口。Mock 历史由同一模拟函数回算；真实接口仅显示本次会话实际收到的历史，最多保留每个 ID 的 1800 个秒级样本。
- Canvas 绘制独立于 Vue UI，见 src/cockpit/renderers/lightScene.ts；视频源生命周期在 composables/useVideoSource.ts；统一画布组件为 components/SceneViewport.vue。
- 以 1920×1080 设计，等比缩放适配 2560×1440、1080p；其他宽高比留边。支持 prefers-reduced-motion，关闭装饰性入场、扫描与呼吸动效。

## 数据接口替换：Mock → WebSocket / API

复制 .env.example 为 .env.local，修改后重启：

```dotenv
VITE_STREAM_MODE=websocket
VITE_STREAM_URL=ws://127.0.0.1:8765/frames
```

VITE_STREAM_MODE=api 时，每 100ms GET 同一 URL；mock 为默认模式。接口集中在 src/cockpit/services/stream.ts，实现 DataStream。组件不依赖具体传输方式。异常和断开显示在顶部；当前 WebSocket 断线后重新加载可重连，生产重连策略可在此扩展。

统一类型在 src/cockpit/types.ts。每条 WebSocket 消息或 API 响应为完整 Frame：

```json
{
  "timestamp": 1792240000000,
  "targets": [
    {
      "id": "T005",
      "radar": { "range": 50, "azimuth": 0, "radialVelocity": -8, "rcs": 0.82 },
      "camera": { "bbox": [0.45, 0.55, 0.12, 0.1], "class": "car", "confidence": 0.94 },
      "fusion": {
        "x": 0,
        "y": 50,
        "vx": 0,
        "vy": -8,
        "speed": 8,
        "heading": 180,
        "azimuth": 0,
        "radialVelocity": -8,
        "tangentialVelocity": 0
      },
      "risk": { "value": 0.87, "level": "high" },
      "history": [
        { "x": 0, "y": 50 },
        { "x": 0, "y": 54 }
      ]
    }
  ]
}
```

- timestamp：真实接口使用 Unix 毫秒；顶部延迟代表数据年龄。Mock 用仿真时间，显示 LOCAL，不伪造网络延迟。
- ENU 坐标：x 向东、y 向北，单位米；速度 m/s。方位角、航向角以正北 0°，顺时针增加。
- camera.bbox：相对完整图像的归一化 [x,y,width,height]。视频 contain，边框使用同一 letterbox 变换。
- radar、camera、fusion、risk 可选；雷达和风险场绘制目标位置需 fusion 坐标。单雷达目标也可将位置/速度估计填入统一运动状态，来源分类仍按 radar/camera 是否存在判断。
- history 为可省略的扩展字段，当前→过去排列，省略则无历史航迹。
- 后端应提供同一时间、同一 ID 的关联数据。前端插值位置和视觉框，不代替后端标定、关联与滤波。
- 入站限制最多 256 目标，校验有限数值；若提供 fusion，请填全其运动字段。

src/cockpit/core/fusion.ts 提供坐标与分速度解算：

```text
r = sqrt(x² + y²)
azimuth = atan2(x, y)，转为 [0,360) 度
vr = (vx*x + vy*y) / r    // 正值远离自车
vt = (vx*y - vy*x) / r    // 正值沿方位顺时针
```

Mock 10 Hz 推帧，速度取位置轨迹的一阶导数，渲染约 60 Hz 插值。真实视觉框保留接口坐标，不会被 Mock 投影覆盖。

## 视频与 CARLA

VideoSource：{ type: 'mock' | 'video' | 'carla'; url?: string }。

- VIDEO：浏览器原生 video 解码 HTTP(S) MP4/WebM，再由 Canvas 叠框。URL 需可访问且支持浏览器解码。
- CARLA：ws/wss，每条消息一个 JPEG/PNG Blob 二进制帧。最多同时解码一帧，丢弃积压帧并释放旧 ImageBitmap。检测信息走独立的统一 Frame 接口。
- 网关若采用其他协议，在 composables/useVideoSource.ts 中替换，保留归一化框约定。
- 真实网关需保证图像与检测帧同步；当前显示最新图像和最新目标，不提供硬件级同步。跨设备可在接口层按时间戳缓存对齐。
- 仅切换视频而保持 Mock 数据时，检测框仍是模拟数据；真实联调需同时切换数据接口。
- 默认 Mock 图像、目标来自同一仿真。

## 替换用户风险公式

集中入口：src/cockpit/core/risk.ts 的 computeRiskField(targets, grid, params)，顶部有「TODO: 替换为用户公式」。

当前是演示用各向异性高斯影响的概率合成，不是经过验证的碰撞概率或安全模型。参数 sigma / gain / threshold / predictionSeconds 集中配置；网格 128×96，覆盖东/西、南/北 ±200m。

计算在 core/risk.worker.ts 中以数据频率运行；主线程仅绘制热力纹理和 Marching Squares 等高线。最多一个任务在途，繁忙时仅排队最新数据。

targetContribution() 控制选中目标的虚线贡献边界，需与总场公式一起替换。输出应为有限的 0～1 数值；新版浅色热力纹理由 SceneViewport.vue 生成，低值透明青绿，高值低饱和陶土色。Target.risk 控制单目标标签及指标，总场叠加值可能高于单目标标签。

## 新增代码结构

```text
src/cockpit/
  Dashboard.vue           16:9 单页、统一布局
  styles.css              冰白青绿主题、玻璃材质、16:9 布局
  components/
    StatusBar.vue         指标、时钟、暂停、全屏
    TargetInspector.vue   选中目标与运动状态
    RiskTrend.vue         ECharts 趋势、真实与模拟历史
    UiIcon.vue            统一 SVG 图标
    SceneViewport.vue     三视图、场计算、视频叠框、点击选择
  renderers/
    lightScene.ts         独立 Canvas 城市、目标、雷达绘制
  composables/
    useScene.ts           订阅、插值、统一仿真时间
    useCanvas.ts          DPR、尺寸与 RAF 清理
    useVideoSource.ts     VIDEO / CARLA 解码与清理
  core/
    fusion.ts             运动解算、视觉投影
    risk.ts               可替换公式与色带
    risk.worker.ts        后台计算
    contours.ts           等高线算法
    drawing.ts            Canvas 绘制工具
    core.spec.ts          数学模型与接口回归
  services/stream.ts      Mock / WebSocket / API
  stores/scene.ts         Pinia 状态
  types.ts                数据契约
```

原页面代码保留，说明见 README.legacy.md。首页 / 为驾驶舱，原 /tech、/demo、/data、/team、/console/\* 可通过 hash 访问，例如 /#/console/radar。

## 交付边界

当前雷达、道路、车辆、风险均为可运行演示数据；不包含真实采集后端、检测模型、CARLA 服务或用户尚未提供的风险公式。视频和数据接口需提供实际服务 URL。所有监听、RAF、Worker、图像资源在卸载/切换时清理。新版验收见交付目录「浅色版-交互验收.json」。旧版面板组件保留供参考，新版首页只挂载 SceneViewport。
