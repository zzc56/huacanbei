# 华灿杯 Sentinel

Sentinel 是面向道路场景的目标检测和风险感知系统。参赛版使用 TCR300 毫米波雷达和 RTSP 摄像头，支持实时雷达风险场和历史数据回放。后续目标是将风险场移植到**轮趣 L150 Pro 四驱版**，使用车载**镭神 N10P 激光雷达**，实现风险值、热图、告警、自动减速、停车和绕障。当前仓库收录参赛版源码和移植说明。

## 代码位置

| 路径 | 内容 |
| --- | --- |
| [sentinel/sentinel-backend](sentinel/sentinel-backend) | Fastify 后端、TCR300 解码、风险计算、回放和测试 |
| [sentinel/web](sentinel/web) | Vue 驾驶舱、雷达视图、风险热图和数据适配 |
| [内置回放数据](sentinel/web/public/history) | 演示录像及同一次采集的视觉、雷达与风险场数据 |
| [sentinel/config/devices.example.json](sentinel/config/devices.example.json) | 实时设备配置模板 |
| [docs/vehicle-integration.md](docs/vehicle-integration.md) | L150 Pro 四驱版移植说明 |

## 安装和构建

从 GitHub 克隆仓库或下载并解压 `main` 分支后，在含有本 README 的目录打开 PowerShell。需要 Node.js 22.12 或更高版本。

```powershell
npm.cmd --prefix sentinel/sentinel-backend ci
npm.cmd --prefix sentinel/web ci
npm.cmd --prefix sentinel/sentinel-backend run build
npm.cmd --prefix sentinel/web run build
```

构建完成后，可双击 `sentinel/启动历史回放.cmd`，直接查看内置演示。设备地址和邮件服务按下文在本机配置。账号与回放库的 SQLite 文件会在首次使用时创建。

## 运行参赛版

服务启动后，可打开 [SENTINEL 首页](http://127.0.0.1:4173/)。在首页点击「登录」，可注册邮箱账号或重置密码。发信配置见[后端说明](sentinel/sentinel-backend/README.md#邮箱注册与密码重置)。需要让不同电脑使用同一个账号库和发信邮箱时，将下载版指向同一个 HTTPS 账号服务，见[共用发信邮箱](sentinel/sentinel-backend/README.md#共用发信邮箱)。

### 实时设备

将 `sentinel/config/devices.example.json` 复制为 `sentinel/config/devices.json`，填写 TCR300 的地址、端口和电脑侧网卡地址。模板默认关闭摄像头。启用摄像头时，需要 Python 3.10 或 3.11、与设备匹配的 PyTorch 和 `sentinel/requirements-camera.txt` 中的依赖。将原参赛包的 `yolov8n.pt` 放入 `sentinel/models/`，或在本机配置中指定模型路径。模型及检测库的许可文本见 [Ultralytics AGPL-3.0](sentinel/licenses/ultralytics-AGPL-3.0.txt)。

```powershell
node sentinel/launch.mjs --check
node sentinel/check-devices.mjs
node sentinel/launch.mjs live
```

进入驾驶舱后，在「实时连接」使用「雷达设置」调整连接，在「雷视标定」校准空间和时间，再查看雷达与摄像头的自动关联。有实时数据时可点击「开始录制」，然后「停止并保存」。

### 历史回放

运行 `node sentinel/launch.mjs recording`，或双击 `sentinel/启动历史回放.cmd`，打开自带的录像、雷达和风险场数据。回放进入后默认暂停，点击播放按钮开始播放，可在工具栏选择 0.5×、1×、1.5× 或 2×。实时连接和历史回放共用驾驶舱，可在工具栏直接切换。后端监听本机 3001 端口。

在「历史回放」点击「导入回放」，可选择 Sentinel 导出的 ZIP，或同一次采集的录像和配套数据。「回放库」可以保存当前回放、挑选已保存的录制并导出 ZIP，包内含可单独查看的目标数据 CSV。账号与回放库分别保存在本机 SQLite 数据库。

使用原始长录制接口时，在 `sentinel/数据保存/` 和 `sentinel/sentinel-backend/media/` 恢复原参赛包的数据，再单独启动 `SOURCE_MODE=recording` 的后端。摄像头模型权重和本机配置保存在原参赛包或本机。

## 验证

```powershell
npm.cmd --prefix sentinel/sentinel-backend test
npm.cmd --prefix sentinel/web test
```

依赖原始记录和媒体的后端测试会在缺少相应文件时跳过。前端实测回放集成测试需要启动回放服务并设置 `REAL_DATA_INTEGRATION=1`。

雷视风险场的模拟数据与 Web 绘制验证步骤见[稳定性实验](sentinel/experiments/radar-vision-stability/README.md)。
