# 华灿杯 Sentinel

Sentinel 是面向道路场景的目标检测和风险感知系统。参赛版使用 TCR300 毫米波雷达和 RTSP 摄像头，支持实时雷达风险场和历史数据回放。面向轮趣 L150 Pro 霍尔编码器版的车路协同模式在电脑端融合固定摄像头与车载激光雷达的观测，计算车前风险和速度上限。第一阶段支持低速直行与静止行人的离线演示，硬件接入和实际制动待验证。

## 代码位置

| 路径 | 内容 |
| --- | --- |
| [sentinel/sentinel-backend](sentinel/sentinel-backend) | Fastify 后端、TCR300 解码、风险计算、回放和测试 |
| [sentinel/web](sentinel/web) | Vue 驾驶舱、雷达视图、风险热图和数据适配 |
| [sentinel/config/devices.example.json](sentinel/config/devices.example.json) | 实时设备配置模板 |
| [docs/vehicle-integration.md](docs/vehicle-integration.md) | L150 Pro 四驱版移植说明 |

## 构建和测试

在仓库根目录运行以下命令。需要 Node.js 22.12 或更高版本。

```powershell
npm.cmd --prefix sentinel/sentinel-backend ci
npm.cmd --prefix sentinel/web ci
npm.cmd --prefix sentinel/sentinel-backend test
npm.cmd --prefix sentinel/web test
npm.cmd --prefix sentinel/web run build
```

后端测试会先构建 TypeScript。依赖原始记录和媒体的测试会在相应数据目录缺失时跳过。还有一项前端实测回放集成测试，需要启动回放服务并设置 `REAL_DATA_INTEGRATION=1`。

## 运行参赛版

### 车路协同

完成上面的构建后，双击 `sentinel/启动车路协同.cmd`，或运行 `node sentinel/launch.mjs vehicle`。打开[车路协同驾驶舱](http://127.0.0.1:4173/#/vehicle)，点击“播放演示”。也可以点击“摄像头先发现”“两路看到同一人”“近距离停车”分别查看热图、目标数量和限速。这个入口直接使用后端计算结果，不需要原始录像、设备配置或模型权重。

切换到“实车观测”可同屏查看固定摄像头的实拍画面与检测框、车载雷达目标、融合热图和小车应执行的动作。通过顶部导航可分别打开摄像头、雷达和风险场独立视图。摄像头配置、地面坐标约定和试发命令见[车路协同接入说明](docs/vehicle-integration.md)。

### 实时设备

将 `sentinel/config/devices.example.json` 复制为 `sentinel/config/devices.json`，填写 TCR300 的地址、端口和电脑侧网卡地址。模板默认关闭摄像头。启用摄像头时，需要 Python 3.10 或 3.11、与设备匹配的 PyTorch 和 `sentinel/requirements-camera.txt` 中的依赖。将原参赛包的 `yolov8n.pt` 放入 `sentinel/models/`，或在本机配置中指定模型路径。模型及检测库的许可文本见 [Ultralytics AGPL-3.0](sentinel/licenses/ultralytics-AGPL-3.0.txt)。

```powershell
node sentinel/launch.mjs --check
node sentinel/check-devices.mjs
node sentinel/launch.mjs live
```

### 历史回放

从原参赛包恢复 `sentinel/数据保存/` 和 `sentinel/sentinel-backend/media/` 的原有目录结构，然后运行 `node sentinel/launch.mjs recording`。两个模式的网页均在 [127.0.0.1:4173](http://127.0.0.1:4173/)，后端监听本机 3001 端口。切换模式前用 Ctrl+C 退出当前服务。

原始实测记录、视频、截图、旧演示图片、模型权重和本机配置保存在原参赛包或本机。前端保留用于测试数据适配的数值样例和其中的媒体路径。
