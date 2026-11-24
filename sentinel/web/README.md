# 前端（Vue 3 + TypeScript）

驾驶舱连接后端 `ws://127.0.0.1:3001/stream` 接收实时数据。历史回放读取前端自带的录像和配套实测数据，也支持本机导入。

## 跑起来

平常直接用根目录的 `启动历史回放.cmd` 或 `启动实时系统.cmd`，这两个脚本会把后端和这里一起拉起来。

只想单独起前端的话：

```
cd web
npm start
```

打开 [SENTINEL 首页](http://127.0.0.1:4173/)，或直接查看[内置历史回放](http://127.0.0.1:4173/#/history)。账号、实时连接和回放库依赖本机 3001 端口的后端。

## 开发

```
npm run dev     开发服务器，http://127.0.0.1:5173/
npm run build   类型检查 + 打包到 dist
npm test        vitest
```

`npm run build` 会先跑 `vue-tsc` 再做 Vite 打包，类型不过就不出产物。
接口地址默认写死在代码里（`src/cockpit/services/stream.ts`），要改的话用 `.env.local` 里的 `VITE_STREAM_URL`，改完开发服要重启、成品要重新打包。

根目录 `launch.mjs` 起的是 `dist` 里的成品，改完源码记得重新 build。

## 数据怎么进来的

```
后端 10 Hz WebSocket 帧
  → src/core/RealDataAdapter.ts  校验并转成 FrameData
  → src/cockpit/stores/scene.ts  Pinia 状态
  → 三个 Canvas（摄像头 / 雷达 / 风险场）和左右两侧面板
```

几个文件值得先看：

- `src/core/RealDataStream.ts` 连 WebSocket，管重连、播放暂停、跳转、目标订阅。收不到数据超过 4 秒会自己重连。
- `src/core/RealDataAdapter.ts` 外部数据一律当 unknown 收，逐个校验再落成 `FrameData`。空 CSV、null、非法值都保留"未知"，不当成 0。
- `src/cockpit/composables/useRecordedCamera.ts` 按帧序号把图像和检测框一起提交，解码慢的时候退回同一帧的 JPEG。
- `src/cockpit/components/SceneViewport.vue` 画热图、等高线和检测框，风险值来自后端或保存的数据，前端不重新算风险公式。
- `src/cockpit/Dashboard.vue` 页签和整体布局。

## 几个显示上的约定

- 原始数据是传感器局部 X/Y，硬件轴向和正北还没现场确认，所以界面上写的是"传感器 +Y / 北向待标定"。
- 雷达的 range 和 angle 直接用原始 CSV：`x=r*sin(azimuth)`、`y=r*cos(azimuth)`，画到 canvas 上 y 轴要翻转。
- 检测框原始单位是像素 `[left,top,width,height]`，在 800×448 原图上归一化后再做 contain 缩放。
- 风险场读保存的 `display_field`，按 `valid_field_mask` 过滤，掩码外和无效格点保持透明，悬停显示未知。
- 目标上没有风险值时显示 —，不显示 0。顶部平均/最高只统计有值的那些目标。
- 雷达目标和已关联的摄像头目标共用「车辆 + 雷达编号」。尚未关联的摄像头目标在列表中使用类别和 W 编号。风险场的位置和运动数据以雷达观测为准。

旧的两份前端资料（`README.legacy.md`、`README.mock.md`）描述的是已经不再使用的 mock 和旧页面结构，留给查历史用，跑系统不需要看。
