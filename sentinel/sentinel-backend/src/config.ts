export const config = {
  streamProtocolVersion: 2,
  sensorHz: 10,
  radarMaxRange: 110,
  maxTargets: 64,
  alignmentMs: 80,
  maxAgeMs: 150,
  mahalanobisGate: 9.21, // 二维卡方分布 99% 分位数；门限作用于距离平方。
  trackTtlMs: 800,
  camera: { width: 1280, height: 720, focal: 700, cx: 640, cy: 300, heightMeters: 6 },
  grid: { width: 128, height: 96, resolution: 1, xMin: -64, yMin: 0 },
  risk: { threshold: 0.5, distanceScale: 30, speedScale: 10, ttcScale: 4, sigma: 2, predictionSeconds: 2 },
  historyCapacity: 600,
  maxFrameBytes: 128 * 1024,
  maxBufferedBytes: 256 * 1024,
  coordinates: 'x east, y north; heading/azimuth degrees clockwise from north; radial positive receding',
  bboxFormat: '[left, top, width, height] pixels',
  riskModel: 'exploratory-distance-ttc-v1; relative index, not accident probability',
} as const;
