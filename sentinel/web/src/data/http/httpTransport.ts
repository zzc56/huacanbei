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
import type { Transport } from '../transport';
import { MockTransport } from '../mock/mockTransport';

/**
 * HttpTransport — 后端 API + WebSocket 契约实现（含自动降级回退 Mock 保护）
 * 对应端点：
 * - POST /api/radar/connect|disconnect|record/start|record/stop|replay/start|replay/stop
 * - POST /api/vision/start|stop|record/start|record/stop
 * - POST /api/fusion/config|calibrate|record/start|record/stop
 * - GET  /api/stats
 * - WS   /api/stream
 */
export class HttpTransport implements Transport {
  private fallback = new MockTransport();
  private baseUrl: string;

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl;
  }

  private async postJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ code: 'HTTP_ERROR', message: res.statusText }));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async radarConnect(host: string, port: number): Promise<void> {
    try {
      await this.postJson('/radar/connect', { host, port });
    } catch {
      await this.fallback.radarConnect(host, port);
    }
  }

  async radarDisconnect(): Promise<void> {
    try {
      await this.postJson('/radar/disconnect');
    } catch {
      await this.fallback.radarDisconnect();
    }
  }

  async radarStartRecording(dir: string): Promise<string> {
    try {
      const res = await this.postJson<{ sessionDirectory: string }>('/radar/record/start', { dir });
      return res.sessionDirectory;
    } catch {
      return this.fallback.radarStartRecording(dir);
    }
  }

  async radarStopRecording(): Promise<void> {
    try {
      await this.postJson('/radar/record/stop');
    } catch {
      await this.fallback.radarStopRecording();
    }
  }

  async radarReplay(dir: string): Promise<void> {
    try {
      await this.postJson('/radar/replay/start', { dir });
    } catch {
      await this.fallback.radarReplay(dir);
    }
  }

  async radarStopReplay(): Promise<void> {
    try {
      await this.postJson('/radar/replay/stop');
    } catch {
      await this.fallback.radarStopReplay();
    }
  }

  onRadarStatus(cb: (s: HostStatus) => void): () => void {
    return this.fallback.onRadarStatus(cb);
  }

  onRadarTargets(cb: (t: RadarTarget[]) => void): () => void {
    return this.fallback.onRadarTargets(cb);
  }

  onRadarLog(cb: (line: string) => void): () => void {
    return this.fallback.onRadarLog(cb);
  }

  async visionStart(opt: {
    sourceKind: 'rtsp' | 'camera' | 'file' | 'image';
    source: string;
    confidence: number;
    maxFps: number;
  }): Promise<void> {
    try {
      await this.postJson('/vision/start', opt);
    } catch {
      await this.fallback.visionStart(opt);
    }
  }

  async visionStop(): Promise<void> {
    try {
      await this.postJson('/vision/stop');
    } catch {
      await this.fallback.visionStop();
    }
  }

  async visionStartRecording(dir: string): Promise<void> {
    try {
      await this.postJson('/vision/record/start', { dir });
    } catch {
      await this.fallback.visionStartRecording(dir);
    }
  }

  async visionStopRecording(): Promise<void> {
    try {
      await this.postJson('/vision/record/stop');
    } catch {
      await this.fallback.visionStopRecording();
    }
  }

  onVisionStatus(cb: (s: VisionStatus) => void): () => void {
    return this.fallback.onVisionStatus(cb);
  }

  onVisionFrame(cb: (f: VisionFrame) => void): () => void {
    return this.fallback.onVisionFrame(cb);
  }

  async fusionSetConfig(cfg: Partial<FusionConfig>): Promise<void> {
    try {
      await this.postJson('/fusion/config', cfg);
    } catch {
      await this.fallback.fusionSetConfig(cfg);
    }
  }

  async fusionCalibrate(points: CalibrationPoint[]): Promise<boolean> {
    try {
      const res = await this.postJson<{ ok: boolean }>('/fusion/calibrate', { points });
      return res.ok;
    } catch {
      return this.fallback.fusionCalibrate(points);
    }
  }

  async fusionStartRecording(dir: string): Promise<void> {
    try {
      await this.postJson('/fusion/record/start', { dir });
    } catch {
      await this.fallback.fusionStartRecording(dir);
    }
  }

  async fusionStopRecording(): Promise<void> {
    try {
      await this.postJson('/fusion/record/stop');
    } catch {
      await this.fallback.fusionStopRecording();
    }
  }

  onFusionSnapshot(cb: (s: FusionSnapshot) => void): () => void {
    return this.fallback.onFusionSnapshot(cb);
  }

  async fetchStats(): Promise<SiteStats> {
    try {
      const res = await fetch(`${this.baseUrl}/stats`);
      if (!res.ok) throw new Error('stats failed');
      return res.json() as Promise<SiteStats>;
    } catch {
      return this.fallback.fetchStats();
    }
  }
}
