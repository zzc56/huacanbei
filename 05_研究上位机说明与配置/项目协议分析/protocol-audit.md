# TCR300-Self TCP 协议复用审计（2026-10-12）

## 已验证范围

对原厂家 DLL 和 EXE 做只读 IL 审计，使用原 `ProtocolsLib.dll` 在本地运行构造报文。没有连接雷达、没有发送命令。离线通过 **1698 个断言**；这不能代替真实车辆联调。

- `ProtocolOfflineProbe.cs` / `.exe`：可复现离线验证器（x86 .NET Framework）。源文件 `vendor` 路径指向原包。
- `synthetic-cycles.bin`：7 个报文，共 98 字节；构造测试数据，禁止称为实测。
- `synthetic-noisy-cycles.bin`：上述数据前增加 5 个噪声字节 `00 11 AA 01 02`，103 字节。
- `offline-probe-result.json`：DLL 实际解析结果、测试计数、canonical hex。
- `protocol-il.txt` / `app-receive-il.txt`：静态审计证据。

## 初始化

原程序 `RadarManage` 将雷达类型和连接类型拼为 `TCR300-Self_TCP`。

```csharp
ProtocolsLib.Config.ConfigImpl.loadConfig(); // BaseDirectory/Config/config.xml
IProtocol protocol = new ProtocolManage().InitProtocol("TCR300-Self_TCP");
```

`Config/config.xml` 的该 key 对应 `Pro_Mainland_COM`。实际返回类型为 `ProtocolsLib.Pro_Mainland_COM`。仅传 `TCR300-Self` 已验证返回 null。

也可 `new Pro_Mainland_COM()` 直接创建解析器；此方式不需要加载协议映射配置。需要独立实例与单线程有序调用，避免跨连接共享周期状态。

## TCP 流与报文

固定 14 字节：`AA AA ID低字节 ID高字节 payload[8] 55 55`。ID 为 little-endian。厂家此解析器只检查头尾，没有长度字段、CRC 或 checksum 校验。

- 报文 ID 中低字节 bit[7:4] 为 radarId：`radarId=(id&0x00F0)>>4`。
- 分发命令时使用 `id&0x0F0F`，剔除 radarId 位。
- `0x060A`：目标周期开始，触发 `cycleStartEvent(true)`。
- `0x060B`：8 字节目标数据，触发 `receiveTarEvent`。
- `0x0600` / `0x0701`：另一套 cluster 周期/点数据，不能混进目标 Object 周期。
- `0x070C`：另一种目标格式（`BytesToObjectInfo70C`），需要另行记录类型，不能按本 fixture 的位域解释。

原接收链 `RadarManage.FuncHandle` 使用：

```csharp
List<byte> frame;
int consumed = protocol.GetCompleteFrameByteList(pending, out frame);
```

此重载**不修改 pending**。返回从 pending 开头可消费的字节数，包含前导噪声和完整报文；若没有完整报文也可能只返回可丢弃的前导噪声。`consumed==0` 时需保留输入等待后续字节。

正确循环：append 新字节 → 抽帧 → RemoveRange(0,consumed) → 若 frame!=null 则解析 → 继续抽帧直到 consumed==0。**frame 为 null 不代表空目标周期**；它可能只是噪声。

`AnalysisFrameByteList(frame)` 会移除头尾，将传入列表改为 8 字节 payload。先保存完整原始报文，并把副本交给 DLL。对齐的 14 字节头尾不能证明数据没有位错误；原始 TCP 字节仍需留档。

通过的场景：7 个粘连报文、canonical 流的全部 97 个切分位置、噪声前缀加逐字节输入、13 字节半包不消费、抽帧不修改输入、解析修改副本。

## 周期边界与时间

`cycleStartEvent.isStart` 在该协议仅发 true，**没有 end(false)**。DLL 对 `0x060A` 的 8 字节 payload 不做任何读取，所以不能从此事件宣称已经获得硬件帧号、目标总数或设备时间。`UpdateFrameArgs.FrameID` 属于另一类升级事件，不是目标测量帧号。

建议收到第一个 start 后开始周期缓存；下一个 start 到达时关闭上一个周期、发出其完整快照，并打开新周期。连续两个 start 可关闭一个经边界确认的空周期。连接开始之前收到的目标记为无起始边界；停止/断线时尾周期记录为 `complete=false`，不要将其与下一个连接拼接。

`ObjectInfo.time` 是 DLL 在解析时调用 `DateTime.Now.ToString("HH:mm:ss.fff")` 生成的**电脑时间字符串**，无日期、无时区、无硬件时间。研究主机应另存 UTC 时间与单调计时值；这仍属于接收/处理时间，不能称雷达和视频已精确同步。

## 0x060B payload 字段

下表用 b[0]…b[7] 指 8 字节 payload。字段数值和偏置均经实际 DLL fixture 验证；物理分类含义不能仅凭整数自行命名。

| 字段 | DLL 公式 / 含义 |
|---|---|
| tarID | b0 |
| tarDisLong / y | `((b1<<5)+(b2>>3))*0.2-500`，m |
| tarDisLat / x | `(((b2&7)<<8)+b3)*0.2-204.6`，m |
| tarVrelLong / vy | `((b4<<2)+(b5>>6))*0.25-128`，m/s |
| tarVrelLat / vx | `(((b5&63)<<3)+(b6>>5))*0.25-64`，m/s |
| tarClass | `(b6>>3)&3`，仅记录原始 code |
| tarDynProp | `b6&7`，仅记录原始 code |
| tarRCS | `b7*0.5-64`，DLL 数值，单位需厂家文档确认 |
| tarDis | `sqrt(x*x+y*y)`，m |
| tarAngle | `atan2(x,y)*180/pi`，degree |
| tarSNR / tarEnergy | 此方法没有赋值，保持 0，不能当实测 SNR/能量 |
| radarType | 此方法没有赋值；原 EXE 在上层补填 |

`tarVrel` 依赖全局静态 `InfoData.velSelect`：`"1"` 速度模长；`"2"` 横向速度；`"3"` 纵向速度；默认也为纵向速度。`"0"` 分支使用 `vy*cos(angle)+vy*sin(angle)`（两项均使用 vy），存在可疑实现，不宜用来提供研究标量速度。本 probe 明确设 `velSelect="3"`。保留 vx/vy，并自主定义所需速度量更清楚。

## canonical fixture

周期 start payload 全零是**未赋予含义的占位数据**，此 DLL 忽略它们；不要把首字节零理解成真实目标数。

```text
AA AA 0A 06 00 00 00 00 00 00 00 00 55 55  # start
AA AA 0B 06 00 55 F4 09 74 20 4A 94 55 55  # target id=0
AA AA 0B 06 01 5A A3 F0 88 1F D0 6C 55 55  # target id=1
AA AA 0A 06 00 00 00 00 00 00 00 00 55 55  # closes 2-target cycle
AA AA 0A 06 00 00 00 00 00 00 00 00 55 55  # closes confirmed empty cycle
AA AA 0B 06 01 5A A3 F0 88 1F D0 6C 55 55  # target id=1
AA AA 0A 06 00 00 00 00 00 00 00 00 55 55  # closes 1-target cycle; final cycle remains open
```

| 目标 | x (m) | y (m) | vx (m/s) | vy (m/s) | class code | dyn code | RCS 数值 |
|---|---:|---:|---:|---:|---:|---:|---:|
| id=0 | 2 | 50 | 0.5 | -12 | 1 | 2 | 10 |
| id=1 | -3 | 80 | -0.5 | 8 | 2 | 0 | -10 |

应关闭 3 个周期，其目标数为 `[2,0,1]`；末尾第 4 个 start 只打开新周期，不应立即计为一个完整空周期。

## 尚需设备联调验证

以上来自现有版本 DLL 的软件行为。尚未验证真实固件输出是否始终发送 0x060A/0x060B、其周期 payload 定义、是否完整输出所有目标、目标分类字典、丢失报文后的恢复特征及与摄像头的时间偏移。接设备后先采原始流，与原上位机可见目标对照。
