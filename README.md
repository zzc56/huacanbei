# 华灿杯 Sentinel

Sentinel 是面向道路场景的目标检测和风险感知系统。参赛版使用 TCR300 毫米波雷达和 RTSP 摄像头，支持实时雷达风险场和历史数据回放。L150 Pro 车路协同模式支持实车键盘控制、编码器反馈和车载雷达停车测试。车路风险接口计算融合风险和建议限速，实车融合限速待联调。

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

完成上面的构建后，双击 `sentinel/启动车路协同.cmd`，或运行 `node sentinel/launch.mjs vehicle`。打开[车路协同驾驶舱](http://127.0.0.1:4173/#/vehicle)，进入“小车控制”并连接实车串口。

控制页可同屏查看固定摄像头的实拍画面与检测框、车载雷达回波、融合热图和编码器轮速。通过顶部导航可分别打开摄像头、雷达和风险场独立视图。摄像头配置、地面坐标约定和试发命令见[车路协同接入说明](docs/vehicle-integration.md)。

#### 球类识别

该分支包含通用 YOLOv8n ONNX 和篮球专用 ONNX，普通 `git clone` 或 `git pull` 会一起下载。使用 `devices.example.json` 协助配置本机摄像头地址和 Python 路径。更新后，在仓库根目录运行：

```powershell
# 首次安装环境时创建虚拟环境。已有环境时用 devices.json 中的 Python 路径执行安装。
py -3.11 -m venv sentinel/.venv
sentinel/.venv/Scripts/python.exe -m pip install -r sentinel/requirements-camera.txt
npm.cmd --prefix sentinel/sentinel-backend ci
npm.cmd --prefix sentinel/sentinel-backend run build
npm.cmd --prefix sentinel/web ci
npm.cmd --prefix sentinel/web run build
node sentinel/launch.mjs vehicle
```

「摄像头感知」默认使用 **C · 人和球**，也可以选择 **B · 球类**。页面的视频信息出现「篮球专用」表示专用模型已加载。可以在本机 `devices.json` 用 `camera.basketballOnnxPath` 指定其他固定尺寸、含 `basketball` 类别、未内嵌 NMS 的检测 ONNX。留空会自动使用随分支的模型，设为 `false` 可改用通用检测和篮球外观补检。

模型来源为 [Ultralytics YOLOv8](https://docs.ultralytics.com/models/yolov8/) 和 [Swish-Vision](https://github.com/ahmedsilat44/Swish-Vision/blob/HEAD/models/best.pt) 的 ONNX 导出。

### 实时设备

将 `sentinel/config/devices.example.json` 复制为 `sentinel/config/devices.json`，填写 TCR300 的地址、端口和电脑侧网卡地址。模板默认关闭摄像头。启用摄像头时，需要 Python 3.10 或 3.11、与设备匹配的 PyTorch 和 `sentinel/requirements-camera.txt` 中的依赖。启用后可直接使用随分支的通用 ONNX，也可在本机配置中指定模型路径。检测库的许可文本见 [Ultralytics AGPL-3.0](sentinel/licenses/ultralytics-AGPL-3.0.txt)。

```powershell
node sentinel/launch.mjs --check
node sentinel/check-devices.mjs
node sentinel/launch.mjs live
```

### 历史回放

从原参赛包恢复 `sentinel/数据保存/` 和 `sentinel/sentinel-backend/media/` 的原有目录结构，然后运行 `node sentinel/launch.mjs recording`。两个模式的网页均在 [127.0.0.1:4173](http://127.0.0.1:4173/)，后端监听本机 3001 端口。切换模式前用 Ctrl+C 退出当前服务。

原始实测记录、视频、截图、旧演示图片和本机设备配置保存在原参赛包或本机。前端保留用于测试数据适配的数值样例和其中的媒体路径。
