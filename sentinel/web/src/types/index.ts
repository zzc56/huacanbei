export interface RadarTarget {
  id: number;
  cls: number;            // 桌面端 Class，0 与非 0 仅影响颜色
  x: number;
  y: number;              // m
  vx: number;
  vy: number;             // m/s
  range: number;
  angle: number;
  velocity: number;
  rcs: number;
  snr: number;
  energy: number;
  vendorTime: string;     // HH:mm:ss.fff（主机解析时间，非硬件时间戳）
  sequence: number;
  receiveUtc: string;     // ISO8601
}

export interface HostStatus {
  state: 'Disconnected' | 'Connecting' | 'Connected' | 'Disconnecting' | 'Replay' | 'Faulted';
  message: string;
  sessionDirectory: string | null;
  sourceKind: 'live_tcp' | 'replay' | 'synthetic_self_test' | null;
  connected: boolean;
  recording: boolean;
  bytesReceived: number;
  targetCount: number;
  messageCount: number;
  lastReceiveUtc: string | null;
}

export type VisionClassId = 0 | 1 | 2 | 3 | 5 | 7;

export interface VisionBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  classId: VisionClassId;
  label: 'person' | 'bicycle' | 'car' | 'motorcycle' | 'bus' | 'truck';
}

export interface VisionFrame {
  sequence: number;
  sourceKind: string;
  capturedUtc: string;
  width: number;
  height: number;
  inferenceMs: number;
  boxes: VisionBox[];
  previewDataUrl: string;
}

export interface VisionStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  message: string;
  sessionDirectory: string | null;
  running: boolean;
  recording: boolean;
}

export interface FusionObject {
  id: string;
  kind: 'radar' | 'pedestrian';
  source: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  confidence: number;
  velocityKnown: boolean;
  observedUtc: string;
  vendorClass: number;
}

export interface FusionPair {
  radarId: string;
  pedestrianId: string;
  timeToClosestSeconds: number;
  closestDistanceMeters: number;
  closingSpeedMps: number;
  relativeRisk: number;
}

export interface CalibrationPoint {
  imageX: number;
  imageY: number;
  groundX: number;
  groundY: number;
}

export interface FusionConfig {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  gridResolution: number;
  maxAgeMs: number;
  alignWindowMs: number;
  cameraOffsetMs: number;
  extendRadarField: boolean;
  fieldScope: 'joint' | 'radar_only' | 'unavailable';
}

export interface FusionSnapshot {
  fieldAvailable: boolean;
  calibrationValid: boolean;
  radarFresh: boolean;
  visionFresh: boolean;
  timeMatched: boolean;
  liveEligible: boolean;
  status: 'ok' | 'pending' | 'expired' | 'uncalibrated';
  message: string;
  alignmentBasis: string;
  modelVersion: string;
  capturedUtc: string;
  timeDifferenceMs: number | null;
  referenceLagMs: number | null;
  config: FusionConfig;
  gridWidth: number;
  gridHeight: number;
  xAxis: number[];
  yAxis: number[];
  displayField: number[] | null; // row-major，length = gridWidth*gridHeight；null=不可用，禁止填 0
  validFieldMask: boolean[] | null;
  rawMax: number;
  rawMean: number;
  radarObjects: FusionObject[];
  pedestrians: FusionObject[];
  interactions: FusionPair[];
  quality: string[];
  computeMs: number;
  radarDropped: number;
  visionMergedCount?: number;
  calibration: CalibrationPoint[] | null;
}

export interface SiteStats {
  sessions: number;
  targets: number;
  classes: { label: string; count: number }[];
  timeline: { t: string; n: number }[];
}

export const COPY = {
  // 边界声明
  FUSION_FOOTER: '暖色强度=raw/(1+raw)，非概率；车辆 4.5×1.8m 是模型先验。OBS裁剪/视角变化须重标定，原始雷达/视频需各采集页保存。',
  RADAR_FOOTER: '图表展示最近 2 秒的目标事件，非厂家帧快照；人车视觉单独采集，融合页需要地面标定与时延核对。',
  FUSION_TITLE: '雷达 + 人车视觉｜相对风险场（探索模型，非概率）',
  VISION_TITLE: '人车检测｜视觉框，非雷达目标',
  TARGET_TABLE_TITLE: '目标事件 · 厂家字段映射待实测（最多 128 个）',
  PROTOTYPE_BADGE: '研究原型｜融合待现场验证',
  REPLAY_BADGE: '离线回放｜采集文件 · 硬件未验证',
  SYNTHETIC_BADGE: '合成数据回放｜非实测',
  DATA_PAGE_BOUNDARY: '无目标不代表安全；风险值是探索性相对指标，不是事故概率。',
  VISION_FOOTER: '视觉会话 schema_version=2；frames.csv 含 vehicle_count、detection_count，person_count 仅计行人。计数为当前帧数量，非去重交通流。',

  // 状态/提示文案
  FUSION_EMPTY: '等待来源。雷达车辆场可独立显示；行人米制坐标需要现场标定。',
  FUSION_EXPIRED: '后台结果已过期，已隐藏目标和联合风险场；等待新观测。',
  FUSION_GENERATION_CHANGED: '来源或参数已变化，等待当前代际的新结果。',
  FUSION_CALIBRATED: '标定已应用；请用额外检查点验证定位误差。',
  FUSION_PARAM_PENDING: '参数等待后台应用。',
  FUSION_BG_EMPTY: '后台计算：等待结果；输入有界，原始采集独立保存。',
  FUSION_SAVE_EMPTY: '融合保存：未开启',
  SESSION_DIR_EMPTY: '实验文件夹：开始保存后生成',
  VISION_METRIC_EMPTY: '当前帧行人 / 车辆：—   画面：—   推理：—',
  VISION_TIME_EMPTY: '处理时刻：—',
  VISION_STOPPED: '视觉未启动',
  HINT_RTSP: '填写完整 RTSP 地址；输入会遮挡，不会记住地址或密码。现有设备取流路径尚待验证。',
  HINT_CAMERA: '填写本机摄像头编号，例如 0；OBS 虚拟摄像机编号取决于设备枚举，需手动验证。',
  HINT_FILE: '离线素材：选择本地视频；检测结果不代表当前道路实测。',
  HINT_IMAGE: '离线素材：选择本地图片；检测结果不代表当前道路实测。',
  TOOLTIP_EXTEND_RADAR: '雷达车辆影响核覆盖显示范围；识别到的行人在视频中画框，地面投影和人车融合仍限于实测标定区。场值不是覆盖完整性或事故概率。',
  TOOLTIP_RESET_VIEW: '恢复完整范围（也可双击图表）。滚轮缩放、按住左键拖动，只改变视图。',
  TOOLTIP_SCATTER: '整图缩放：滚轮向上放大、向下缩小；按住左键拖动；双击恢复。X/Y范围、刻度值及目标坐标不变，文字和图形一起放大。',
  TOOLTIP_TARGET_COL: '按厂家接口字段映射；坐标方向与速度字段尚待设备实测确认。',
  LOG_DISCONNECTED: '未连接设备。请选择保存目录，连接雷达后手动开始保存。',
  LOG_FIELD_NOTE: '坐标和速度字段按厂家接口映射，尚待设备实测确认。'
} as const;
