export interface RiskZone { row: number; startColumn: number; values: number[] }
export interface Target {
  id: string;
  radar?: { range: number; azimuth: number; radialVelocity: number };
  camera?: { bbox: [number, number, number, number]; class: string; confidence: number };
  fusion: { x: number; y: number; speed: number; heading: number; azimuth: number; radialVelocity: number; tangentialVelocity: number };
  risk: { value: number; level: 'low' | 'mid' | 'high' };
}
export interface FrameData {
  timestamp: number; fps: number; targets: Target[];
  riskField?: { gridWidth: number; gridHeight: number; resolution: number; highRiskZones: RiskZone[] };
}
/** 协方差矩阵 [[xx,xy],[xy,yy]]，单位 m²；必须正定。 */
export interface Covariance { xx: number; xy: number; yy: number }
export interface RadarObservation { timestamp: number; range: number; azimuth: number; radialVelocity: number; covariance: Covariance }
export interface CameraObservation { timestamp: number; bbox: [number, number, number, number]; class: 'Car' | 'Truck'; confidence: number; covariance: Covariance }
/** 适配器须提供同一局部坐标原点、已同步的毫秒时间戳及地面坐标协方差。 */
export interface SensorBatch { timestamp: number; radar: RadarObservation[]; camera: CameraObservation[] }
export interface SensorSource { sample(dtSeconds: number, timestamp: number): SensorBatch; reset(): void }
export type SourceTag = 'fused' | 'radar_only' | 'vision_only';
export interface TrackStatus { id: string; tag: SourceTag; velocityValid: boolean }
export interface FusionResult { targets: Target[]; statuses: TrackStatus[] }
export type Segment = [number, number, number, number];
export type ControlAction = 'play' | 'pause' | 'reset';
export interface WorkerCommand { requestId: number; action: ControlAction }
export interface PipelineFrame { type: 'frame'; frame: FrameData; json: string; statuses: TrackStatus[]; contours: Segment[]; contourDue: boolean }
export type WorkerOutput = PipelineFrame | { type: 'ack'; requestId: number; state: 'playing' | 'paused' };
