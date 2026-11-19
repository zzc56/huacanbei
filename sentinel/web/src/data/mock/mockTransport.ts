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
import { COPY } from '@/types';
import type { Transport } from '../transport';
import { RadarSimulator } from './radarSim';
import { VisionSimulator } from './visionSim';
import { FusionSimulator, type FusionDemoMode } from './fusionSim';
import { formatTimeHms } from '@/utils/format';

export class MockTransport implements Transport {
  private radarSim = new RadarSimulator('busy');
  private visionSim = new VisionSimulator();
  private fusionSim = new FusionSimulator();

  private radarStatus: HostStatus = {
    state: 'Disconnected',
    message: COPY.LOG_DISCONNECTED,
    sessionDirectory: null,
    sourceKind: null,
    connected: false,
    recording: false,
    bytesReceived: 0,
    targetCount: 0,
    messageCount: 0,
    lastReceiveUtc: null
  };

  private visionStatus: VisionStatus = {
    state: 'stopped',
    message: COPY.VISION_STOPPED,
    sessionDirectory: null,
    running: false,
    recording: false
  };

  private radarStatusListeners = new Set<(s: HostStatus) => void>();
  private radarTargetListeners = new Set<(t: RadarTarget[]) => void>();
  private radarLogListeners = new Set<(line: string) => void>();
  private visionStatusListeners = new Set<(s: VisionStatus) => void>();
  private visionFrameListeners = new Set<(f: VisionFrame) => void>();
  private fusionListeners = new Set<(s: FusionSnapshot) => void>();
  private fusionTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startFusionLoop();
  }

  private emitRadarLog(msg: string): void {
    const line = `${formatTimeHms(new Date())}  ${msg}`;
    this.radarLogListeners.forEach((cb) => cb(line));
  }

  private emitRadarStatus(): void {
    const snap = { ...this.radarStatus };
    this.radarStatusListeners.forEach((cb) => cb(snap));
  }

  private emitVisionStatus(): void {
    const snap = { ...this.visionStatus };
    this.visionStatusListeners.forEach((cb) => cb(snap));
  }

  private startFusionLoop(): void {
    if (this.fusionTimer) clearInterval(this.fusionTimer);
    this.fusionTimer = setInterval(() => {
      const active = this.radarStatus.connected || this.radarStatus.state === 'Replay'
        ? this.radarSim.getActiveTargets()
        : [];
      const snap = this.fusionSim.buildSnapshot(active);
      this.fusionListeners.forEach((cb) => cb(snap));
    }, 250);
  }

  setFusionDemoMode(mode: FusionDemoMode): void {
    this.fusionSim.setDemoMode(mode);
    const active = this.radarStatus.connected ? this.radarSim.getActiveTargets() : [];
    const snap = this.fusionSim.buildSnapshot(active);
    this.fusionListeners.forEach((cb) => cb(snap));
  }

  async radarConnect(host: string, port: number): Promise<void> {
    this.radarStatus = {
      ...this.radarStatus,
      state: 'Connecting',
      message: `正在连接 ${host}:${port}…`
    };
    this.emitRadarStatus();
    this.emitRadarLog(`正在连接 TCR300 雷达 ${host}:${port}…`);

    await new Promise((r) => setTimeout(r, 180));

    this.radarSim.setPreset('busy');
    this.radarStatus = {
      ...this.radarStatus,
      state: 'Connected',
      connected: true,
      sourceKind: 'live_tcp',
      message: `已连接 ${host}:${port}`
    };
    this.emitRadarStatus();
    this.emitRadarLog(`已连接 ${host}:${port} (TCR300-Self)`);
    this.emitRadarLog(COPY.LOG_FIELD_NOTE);

    this.radarSim.start((batch) => {
      this.radarStatus.bytesReceived += 122880;
      this.radarStatus.targetCount += batch.length;
      this.radarStatus.messageCount += 1;
      this.radarStatus.lastReceiveUtc = batch[batch.length - 1]?.receiveUtc ?? new Date().toISOString();
      this.emitRadarStatus();
      const visible = this.radarSim.getActiveTargets(Date.now(), 2000);
      this.radarTargetListeners.forEach((cb) => cb(visible));
    }, 100);
  }

  async radarDisconnect(): Promise<void> {
    this.radarSim.stop();
    this.radarStatus = {
      ...this.radarStatus,
      state: 'Disconnected',
      connected: false,
      recording: false,
      sourceKind: null,
      message: COPY.LOG_DISCONNECTED
    };
    this.emitRadarStatus();
    this.emitRadarLog('连接已断开。');
  }

  async radarStartRecording(dir: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sessionDir = `${dir.replace(/\/$/, '')}/radar_session_${stamp}`;
    this.radarStatus = {
      ...this.radarStatus,
      recording: true,
      sessionDirectory: sessionDir,
      message: '正在保存原始报文与目标事件'
    };
    this.emitRadarStatus();
    this.emitRadarLog(`开始保存会话至 ${sessionDir}`);
    return sessionDir;
  }

  async radarStopRecording(): Promise<void> {
    this.radarStatus = {
      ...this.radarStatus,
      recording: false,
      message: '已停止保存'
    };
    this.emitRadarStatus();
    this.emitRadarLog('停止保存会话。');
  }

  async radarReplay(dir: string): Promise<void> {
    this.radarSim.stop();
    const isSynthetic = dir.includes('synthetic');
    this.radarSim.setPreset('replay');
    this.radarStatus = {
      ...this.radarStatus,
      state: 'Replay',
      connected: false,
      recording: false,
      sourceKind: isSynthetic ? 'synthetic_self_test' : 'replay',
      sessionDirectory: dir,
      message: isSynthetic ? COPY.SYNTHETIC_BADGE : COPY.REPLAY_BADGE
    };
    this.emitRadarStatus();
    this.emitRadarLog(`启动离线回放：${dir}`);
    this.emitRadarLog(COPY.LOG_FIELD_NOTE);

    this.radarSim.start((batch) => {
      this.radarStatus.bytesReceived += 65536;
      this.radarStatus.targetCount += batch.length;
      this.radarStatus.messageCount += 1;
      this.radarStatus.lastReceiveUtc = batch[batch.length - 1]?.receiveUtc ?? new Date().toISOString();
      this.emitRadarStatus();
      const visible = this.radarSim.getActiveTargets(Date.now(), 2000);
      this.radarTargetListeners.forEach((cb) => cb(visible));
    }, 100);
  }

  async radarStopReplay(): Promise<void> {
    this.radarSim.stop();
    this.radarStatus = {
      ...this.radarStatus,
      state: 'Disconnected',
      connected: false,
      sourceKind: null,
      message: COPY.LOG_DISCONNECTED
    };
    this.emitRadarStatus();
    this.emitRadarLog('已停止离线回放。');
  }

  onRadarStatus(cb: (s: HostStatus) => void): () => void {
    this.radarStatusListeners.add(cb);
    cb({ ...this.radarStatus });
    return () => this.radarStatusListeners.delete(cb);
  }

  onRadarTargets(cb: (t: RadarTarget[]) => void): () => void {
    this.radarTargetListeners.add(cb);
    return () => this.radarTargetListeners.delete(cb);
  }

  onRadarLog(cb: (line: string) => void): () => void {
    this.radarLogListeners.add(cb);
    cb(`${formatTimeHms(new Date())}  ${COPY.LOG_DISCONNECTED}`);
    return () => this.radarLogListeners.delete(cb);
  }

  async visionStart(opt: {
    sourceKind: 'rtsp' | 'camera' | 'file' | 'image';
    source: string;
    confidence: number;
    maxFps: number;
  }): Promise<void> {
    this.visionSim.configure(opt);
    this.visionStatus = {
      ...this.visionStatus,
      state: 'running',
      running: true,
      message: `正在检测（来源：${opt.sourceKind}，上限 ${opt.maxFps} 帧/秒）`
    };
    this.emitVisionStatus();
    this.visionSim.start((frame) => {
      this.visionFrameListeners.forEach((cb) => cb(frame));
    });
  }

  async visionStop(): Promise<void> {
    this.visionSim.stop();
    this.visionStatus = {
      ...this.visionStatus,
      state: 'stopped',
      running: false,
      recording: false,
      message: COPY.VISION_STOPPED
    };
    this.emitVisionStatus();
  }

  async visionLoadOfflineSample(confidence: number): Promise<VisionFrame> {
    this.visionSim.setConfidence(confidence);
    const frame = this.visionSim.stepFrame(true);
    this.visionStatus = {
      ...this.visionStatus,
      state: 'running',
      running: true,
      message: '已加载离线示例图（road-sample.jpg，非实时道路流）'
    };
    this.emitVisionStatus();
    this.visionFrameListeners.forEach((cb) => cb(frame));
    return frame;
  }

  async visionStartRecording(dir: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.visionStatus = {
      ...this.visionStatus,
      recording: true,
      sessionDirectory: `${dir.replace(/\/$/, '')}/vision_session_${stamp}`,
      message: '正在保存采样图片与 frames.csv (schema_version=2)'
    };
    this.emitVisionStatus();
  }

  async visionStopRecording(): Promise<void> {
    this.visionStatus = {
      ...this.visionStatus,
      recording: false,
      message: '已停止保存视觉采样'
    };
    this.emitVisionStatus();
  }

  onVisionStatus(cb: (s: VisionStatus) => void): () => void {
    this.visionStatusListeners.add(cb);
    cb({ ...this.visionStatus });
    return () => this.visionStatusListeners.delete(cb);
  }

  onVisionFrame(cb: (f: VisionFrame) => void): () => void {
    this.visionFrameListeners.add(cb);
    return () => this.visionFrameListeners.delete(cb);
  }

  async fusionSetConfig(cfg: Partial<FusionConfig>): Promise<void> {
    this.fusionSim.setConfig(cfg);
    const active = this.radarStatus.connected ? this.radarSim.getActiveTargets() : [];
    const snap = this.fusionSim.buildSnapshot(active);
    this.fusionListeners.forEach((cb) => cb(snap));
  }

  async fusionCalibrate(points: CalibrationPoint[]): Promise<boolean> {
    const ok = this.fusionSim.setCalibration(points);
    const active = this.radarStatus.connected ? this.radarSim.getActiveTargets() : [];
    const snap = this.fusionSim.buildSnapshot(active);
    this.fusionListeners.forEach((cb) => cb(snap));
    return ok;
  }

  async fusionStartRecording(_dir: string): Promise<void> {
    // Handled in store session tracking
  }

  async fusionStopRecording(): Promise<void> {
    // Handled in store session tracking
  }

  onFusionSnapshot(cb: (s: FusionSnapshot) => void): () => void {
    this.fusionListeners.add(cb);
    const active = this.radarStatus.connected ? this.radarSim.getActiveTargets() : [];
    cb(this.fusionSim.buildSnapshot(active));
    return () => this.fusionListeners.delete(cb);
  }

  async fetchStats(): Promise<SiteStats> {
    return {
      sessions: 18,
      targets: 42860,
      classes: [
        { label: 'person (行人)', count: 16820 },
        { label: 'car (小汽车)', count: 15240 },
        { label: 'bus (公交车)', count: 3120 },
        { label: 'bicycle (自行车)', count: 4180 },
        { label: 'motorcycle (摩托车)', count: 2150 },
        { label: 'truck (货车)', count: 1350 }
      ],
      timeline: [
        { t: '10-08', n: 4120 },
        { t: '10-09', n: 5890 },
        { t: '10-10', n: 6430 },
        { t: '10-11', n: 7920 },
        { t: '10-12', n: 8640 },
        { t: '10-13', n: 9860 }
      ]
    };
  }
}
