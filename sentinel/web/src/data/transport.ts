import type {
  CalibrationPoint,
  FusionConfig,
  FusionSnapshot,
  HostStatus,
  RadarTarget,
  SiteStats,
  VisionFrame,
  VisionStatus
} from '@/types';
import { MockTransport } from './mock/mockTransport';
import { HttpTransport } from './http/httpTransport';

export interface Transport {
  // 雷达
  radarConnect(host: string, port: number): Promise<void>;
  radarDisconnect(): Promise<void>;
  radarStartRecording(dir: string): Promise<string>;
  radarStopRecording(): Promise<void>;
  radarReplay(dir: string): Promise<void>;
  radarStopReplay(): Promise<void>;
  onRadarStatus(cb: (s: HostStatus) => void): () => void;
  onRadarTargets(cb: (t: RadarTarget[]) => void): () => void;
  onRadarLog(cb: (line: string) => void): () => void;
  // 视觉
  visionStart(opt: {
    sourceKind: 'rtsp' | 'camera' | 'file' | 'image';
    source: string;
    confidence: number;
    maxFps: number;
  }): Promise<void>;
  visionStop(): Promise<void>;
  visionStartRecording(dir: string): Promise<void>;
  visionStopRecording(): Promise<void>;
  onVisionStatus(cb: (s: VisionStatus) => void): () => void;
  onVisionFrame(cb: (f: VisionFrame) => void): () => void;
  // 融合
  fusionSetConfig(cfg: Partial<FusionConfig>): Promise<void>;
  fusionCalibrate(points: CalibrationPoint[]): Promise<boolean>;
  fusionStartRecording(dir: string): Promise<void>;
  fusionStopRecording(): Promise<void>;
  onFusionSnapshot(cb: (s: FusionSnapshot) => void): () => void;
  // 官网统计
  fetchStats(): Promise<SiteStats>;
}

let singleton: Transport | null = null;

export function getTransport(): Transport {
  if (!singleton) {
    const mode = (import.meta as { env?: Record<string, string> }).env?.VITE_DATA_MODE || 'mock';
    singleton = mode === 'http' ? new HttpTransport() : new MockTransport();
  }
  return singleton;
}

export function getMockTransport(): MockTransport | null {
  const t = getTransport();
  return t instanceof MockTransport ? t : null;
}
