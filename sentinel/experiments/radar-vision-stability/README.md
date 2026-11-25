# 雷视风险场稳定性实验

在固定风险网格上复用后端 `RiskFieldEngine`，比较纯雷达与加入行人、自行车视觉估计的场值。每种工况用 32 个可复现的随机种子，各模拟 12 秒，雷达与摄像头的标称采样率都是 10 Hz。摄像头测试覆盖推理结果迟到、丢帧、持续误检和短时断流。

## 复跑

先按[仓库说明](../../../README.md#安装和构建)安装依赖并构建。随后在仓库根目录运行以下命令。

```powershell
node sentinel/experiments/radar-vision-stability/simulate.mjs --steady-hint
node sentinel/experiments/radar-vision-stability/simulate.mjs --stable-field
node sentinel/experiments/radar-vision-stability/check-web-render.mjs
```

`--steady-hint` 在两次可信观测后显示低权重热区，再平滑提升强度。`--stable-field` 进一步将视觉新增场值的相邻帧变化限制为 0.035，并在视觉观测过期后逐步把贡献归零。雷达风险场仍按本次雷达帧计算。先前试验可用 `--windowed` 复跑最近五帧命中三帧的规则，或用默认参数复跑连续三帧规则。

结果 JSON 和浏览器模拟帧写入仓库的 `.cache/radar-vision-stability/`。浏览器验证通过隔离的本地 HTTP 和 WebSocket 服务，把模拟帧送给现有 Web 页面。它检查纯雷达与雷视数据切换期间的画布身份、空白帧和字段连续性。默认使用 Windows 上的 Microsoft Edge，可用 `SENTINEL_EDGE_PATH` 指定可执行文件。

## 验收数据

| 指标 | 低权重提示 | 限制视觉场值变化 |
| --- | ---: | ---: |
| 掉帧工况相邻帧视觉场值跳变超过 0.08 的次数 | 158 | 0 |
| 掉帧工况首次出现明显视觉热区的 P95 延迟 | 2.03 秒 | 2.03 秒 |
| 断流后完全回到纯雷达场的最长时间 | 0.24 秒 | 0.43 秒 |

跳变值是两个连续输出帧之间，同一格点视觉新增场值的最大绝对差。首次明显出现用目标所在网格的视觉新增场值达到 0.03 作为判据。两种策略按相同的模拟雷达时刻出包，现场仍需测量采集、推理、传输到显示的端到端延迟。实验脚本可独立运行。
