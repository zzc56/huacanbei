import type { VisionBox, VisionFrame } from '@/types';

const BASELINE_BOXES: VisionBox[] = [
  // Vehicles aligned with road-sample.jpg
  { x: 0.148, y: 0.215, w: 0.112, h: 0.180, score: 0.94, classId: 5, label: 'bus' },
  { x: 0.452, y: 0.442, w: 0.125, h: 0.145, score: 0.92, classId: 2, label: 'car' },
  { x: 0.472, y: 0.322, w: 0.095, h: 0.088, score: 0.89, classId: 2, label: 'car' },
  { x: 0.315, y: 0.210, w: 0.048, h: 0.048, score: 0.78, classId: 2, label: 'car' },
  { x: 0.594, y: 0.220, w: 0.056, h: 0.052, score: 0.81, classId: 2, label: 'car' },
  { x: 0.650, y: 0.232, w: 0.054, h: 0.055, score: 0.84, classId: 2, label: 'car' },
  // Cyclist in green bike lane
  { x: 0.285, y: 0.608, w: 0.046, h: 0.142, score: 0.87, classId: 1, label: 'bicycle' },
  // Pedestrians on crosswalk & sidewalk
  { x: 0.742, y: 0.438, w: 0.025, h: 0.102, score: 0.88, classId: 0, label: 'person' },
  { x: 0.768, y: 0.478, w: 0.026, h: 0.105, score: 0.85, classId: 0, label: 'person' },
  { x: 0.798, y: 0.508, w: 0.028, h: 0.112, score: 0.91, classId: 0, label: 'person' },
  { x: 0.835, y: 0.525, w: 0.026, h: 0.108, score: 0.76, classId: 0, label: 'person' },
  { x: 0.868, y: 0.495, w: 0.026, h: 0.102, score: 0.64, classId: 0, label: 'person' },
  { x: 0.060, y: 0.652, w: 0.036, h: 0.135, score: 0.58, classId: 0, label: 'person' },
  { x: 0.018, y: 0.665, w: 0.038, h: 0.140, score: 0.49, classId: 0, label: 'person' }
];

export class VisionSimulator {
  private sequence = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private confidence = 0.5;
  private maxFps = 5;
  private sourceKind = 'file';

  configure(opt: { sourceKind: string; confidence: number; maxFps: number }): void {
    this.sourceKind = opt.sourceKind;
    this.confidence = opt.confidence;
    this.maxFps = Math.max(1, Math.min(10, opt.maxFps));
  }

  setConfidence(c: number): void {
    this.confidence = Math.max(0.05, Math.min(0.95, c));
  }

  stepFrame(isOfflineSample = false): VisionFrame {
    this.sequence += 1;
    const frameIndex = ((this.sequence - 1) % 60) + 1;
    const padded = String(frameIndex).padStart(4, '0');
    const previewDataUrl = isOfflineSample
      ? '/mock/road-sample.jpg'
      : `/mock/frames/${padded}.jpg`;

    const phase = this.sequence * 0.18;
    const boxes: VisionBox[] = BASELINE_BOXES.map((b, idx) => {
      const jx = isOfflineSample ? 0 : Math.sin(phase + idx * 1.1) * 0.008;
      const jy = isOfflineSample ? 0 : Math.cos(phase + idx * 0.9) * 0.006;
      const scoreJitter = isOfflineSample ? 0 : Math.sin(phase + idx) * 0.03;
      const score = Math.max(0.45, Math.min(0.96, Number((b.score + scoreJitter).toFixed(2))));
      return {
        ...b,
        x: Math.max(0.01, Math.min(0.95, Number((b.x + jx).toFixed(4)))),
        y: Math.max(0.01, Math.min(0.95, Number((b.y + jy).toFixed(4)))),
        score
      };
    }).filter((b) => b.score >= this.confidence);

    const inferenceMs = Math.round(42 + Math.abs(Math.sin(phase)) * 38);

    return {
      sequence: this.sequence,
      sourceKind: isOfflineSample ? 'offline_sample' : this.sourceKind,
      capturedUtc: new Date().toISOString(),
      width: 1280,
      height: 720,
      inferenceMs,
      boxes,
      previewDataUrl
    };
  }

  start(onFrame: (f: VisionFrame) => void): void {
    this.stop();
    const intervalMs = Math.round(1000 / Math.max(1, Math.min(10, this.maxFps)));
    onFrame(this.stepFrame(false));
    this.timer = setInterval(() => {
      onFrame(this.stepFrame(false));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
