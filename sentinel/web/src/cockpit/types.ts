/** 局部 XY，角度相对 +Y 顺时针；只有 northCalibrated 为 true 时 +Y 代表正北。 */
export interface Target {
  id: string;
  kind?: string;
  measurementSource?: 'radar' | 'recorded-vision' | 'vision-only';
  autoAssociation?: {
    method:'trajectory-geometry-v1';status:'tentative'|'held';radarId:string;visualTrackId:string;
    score:number;samples:number;correlation:number;medianDistance:number;radarAgeMs:number;alignmentDeltaMs:number;
  };
  radar?: { range: number; azimuth: number; radialVelocity: number | null; rcs?: number; sequence?: number };
  camera?: { bbox: [number, number, number, number]; class: string; confidence: number; sequence?: number; detectionIndex?: number; trackId?:string };
  fusion?: {
    x: number;
    y: number;
    vx: number | null;
    vy: number | null;
    speed: number | null;
    heading: number | null;
    azimuth: number;
    radialVelocity: number | null;
    tangentialVelocity: number | null;
  };
  risk?: { value: number; level: 'low' | 'mid' | 'high' };
  history?: { x: number; y: number }[];
  observationTimestamp?: number;
  riskBasis?: 'backend-target' | 'sampled-field';
}
export interface Frame {
  timestamp: number;
  targets: Target[];
  source?: 'recording' | 'live' | 'backend' | 'mock';
  live?: {
    startedAt: number;
    radar: { state: string; endpoint: string; bytes: number; cycles: number; completeCycles: number;
      totalTargets: number; ageMs: number|null; error: string };
    camera: { state: string; message: string };
    fusion: { state: string; message: string };
  };
  riskField?: ScalarField;
  cameraFrame?: { sequence: number; width: number; height: number; timestamp: number; imageUrl?: string; videoUrl?: string; videoTimeSeconds?: number };
  replay?: { positionMs: number; durationMs: number; ended: boolean };
  recordingCounts?: { video: number; detections: number; radar: number; fusion: number };
  bounds?: WorldBounds;
  radarRange?: number;
  northCalibrated?: boolean;
  message?: string;
  fps?: number;
}
export type FrameData = Frame;
export interface WorldBounds { xMin: number; xMax: number; yMin: number; yMax: number }
export interface ScalarField {
  width: number; height: number; xAxis: number[]; yAxis: number[];
  /** Row major, ascending y. NaN means unavailable, never zero. */
  values: Float32Array; valid: Uint8Array; calibrated?: Uint8Array;
  model: string; scope: string; timestamp: number; revision?: string;
}
export type ConnectionState = 'mock' | 'replay' | 'connecting' | 'connected' | 'disconnected' | 'error';
export interface DataStream {
  start(onFrame: (frame: Frame) => void, onStatus: (state: ConnectionState) => void, onPlayback?: (playing: boolean) => void): void;
  setPaused(paused: boolean): void;
  dispose(): void;
  select?(id: string): void;
  seek?(positionMs: number): void;
}
export interface VideoSource {
  type: 'mock' | 'video' | 'carla';
  url?: string;
}
export interface Grid {
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}
export interface RiskParams {
  sigma: number;
  gain: number;
  threshold: number;
  predictionSeconds: number;
}
