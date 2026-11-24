# 后端（Node + TypeScript + Fastify）

三种数据源，用环境变量 `SOURCE_MODE` 选：

- `recording`　读取「数据保存」中的原始实测记录
- `live`　　　接实物雷达 TCP 和网络摄像头 RTSP，默认模式
- `synthetic`　合成数据，只做测试用

根目录 `launch.mjs` 会启动实时接口，前端可以在实时连接与自带历史回放之间切换。

## 单独跑

```
cd sentinel-backend
npm ci
npm run build
npm start
```

默认监听 `127.0.0.1:3001`。可用环境变量：`PORT`、`HOST`、`ALLOWED_ORIGINS`（逗号分隔的完整 Origin，默认只有本机的 5173 和 4173）。
`npm run dev` 是先编译再启动，不是热重载。`npm start` 跑的是 `dist`，改了源码要重新 build。

回放模式要能找到数据目录，默认就是仓库里的 `数据保存`，换位置的话设 `RECORDING_DIR`。

## 邮箱注册与密码重置

在 `sentinel-backend/.env` 中填写 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER` 和 `SMTP_PASS`，然后重启后端。从 `.env.example` 可以复制配置模板。QQ 邮箱的模板使用 `smtp.qq.com` 和端口 `465`，`SMTP_PASS` 填邮箱的 SMTP 授权码。发信服务使用发件邮箱发送验证码。

在首页点「登录 → 忘记密码？」即可使用注册邮箱接收验证码并设置新密码。重置验证码有效期为 10 分钟，重置成功后，该账号已有的登录会话会失效。

账号保存在 `sentinel-backend/auth-data/accounts.sqlite`。首次访问账号接口时，会把同目录下的旧账号 JSON 一次性迁入 SQLite，保留原密码哈希和 JSON 备份。已有账号可以继续使用原密码。设置 `AUTH_DATA_DIR` 可指定账号目录。验证码和登录会话保存在后端内存中。

## 回放库

回放库将录像或采样画面、时间线和目标数据打包为 ZIP，保存在 `sentinel-backend/replay-data/replays.sqlite`。重启后可继续查看和导出已保存的回放。可用 `REPLAY_DATA_DIR` 指定存储目录。

## 接口

| 路径 | 说明 |
| --- | --- |
| GET `/api/health` | 状态和当前模式 |
| GET `/api/config` | 场景、标定、阈值、网格参数 |
| GET `/api/replay/manifest` | 回放清单：时间范围、各类记录条数、录像地址 |
| GET `/api/replay/frame?timeMs=` | 指定时刻的一帧 |
| GET `/api/live/status` | 实时模式的雷达和摄像头状态 |
| GET / POST `/api/replays` | 查询和保存本机回放 |
| GET `/api/replays/:id` | 下载指定回放的 ZIP |
| GET `/media/*` | 回放录像和采样帧，支持 Range |
| POST `/api/control` | synthetic 模式的 play / pause / reset |

WebSocket 是 `ws://127.0.0.1:3001/stream`，原生 ws，不是 Socket.IO。
回放模式先发一条 `replay_manifest`，之后每 100ms 推一帧 `recorded_frame`；
实时模式推 `live_frame`，帧里带 `live.radar.state`、`live.camera.state` 供界面判断在线状态。

客户端发过来的都是很小的 JSON：`{"action":"pause"|"play"|"seek","positionMs":123}`、
`{"action":"select_target","targetId":"ped:36"}`。

## 回放模式怎么取数据

三个来源各自按自己的时间列取，共用一个回放时钟：

- 视觉：取 `captured_utc` 不晚于当前时刻的最新一帧 `frames.csv`，再用 sequence 把它在 `detections.csv` 里的框全部取出来
- 雷达：取 `host_received_utc` 不晚于当前时刻、且年龄不超过 1500ms 的各 track_id 最新记录
- 融合：按 `observation_utc` 取当前快照，只负责它保存下来的位置、关联和风险场

三者不互相阻塞。融合快照过期就清空风险场，不会拿上一个时刻的热区接着用。
放到结尾会自动回到开头继续，演示时不会停在最后一帧。

摄像头关联单独按同一个 `vision_sequence` 去查融合记录，和当前风险快照分开读，
所以会出现"图像上有框、当时风险场引用的却是前一帧"的情况，这是数据本来的样子。

## 实时模式

雷达走 TCP 连 TCR300，解码在 `src/live/tcr300.ts`，组帧和下发在 `src/live/service.ts`。
连接地址、端口和本机绑定地址来自 `config/devices.json`，由根目录 `settings.mjs` 拼成环境变量传进来。
雷达断线或数据超过 1500ms 没更新，`state` 会变成 `disconnected` 或 `stale`，界面上的风险场随之隐藏。

摄像头由 `scripts/live-camera.py` 走 OpenCV 拉 RTSP、本机 YOLO 推理，把 JPEG 和检测框交给 `src/live/camera.ts`。

## 坐标和风险口径

- 地面局部坐标，x 向东、y 向北，单位 m。传感器局部的轴向还没有现场确认。
- 方位角、航向相对正北顺时针，径向正数表示远离。
- 检测框对外是像素 `[left,top,width,height]`。
- 风险是团队的研究相对指标，用距离、接近速度和 TTC 合成，不是事故概率。
  公式在 `src/config.ts` 里可调，默认 `D=30m`、`V=10m/s`、`T=4s`、`σ=2m`。
- 实时融合风险场需要现场联合标定，目前回放用的是当时保存的矩阵，两者不能混用。

## 其他约束

- 单帧超过 128KiB 会被拒绝广播，不会静默丢掉。
- 实时连接每 15 秒 ping/pong，连续拥塞 30 次会主动断开。
- Origin 校验挡的是浏览器跨站，不是身份认证，这套服务只在本机演示用。

## 测试

```
npm run build
npm test
```

覆盖融合、风险场、TCR300 解码（含 483 条厂家记录）、回放时间线和 WebSocket 收发。
