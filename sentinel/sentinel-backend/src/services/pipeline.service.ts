import { Worker } from 'node:worker_threads';
import { config } from '../config.js';
import type { ControlAction, FrameData, PipelineFrame, WorkerOutput } from '../contracts.js';

interface Pending { action: ControlAction; resolve: (state: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
export class PipelineService {
  private readonly worker = new Worker(new URL('../workers/pipeline.worker.js', import.meta.url));
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(message: PipelineFrame) => void>();
  private readonly stateListeners = new Set<(state: 'playing' | 'paused' | 'failed', reset: boolean) => void>();
  private readonly history: (FrameData | undefined)[] = new Array<FrameData | undefined>(config.historyCapacity);
  private cursor = 0;
  private requestId = 0;
  private failure: Error | undefined;
  private closing = false;
  state: 'playing' | 'paused' | 'failed' = 'playing';
  latest: PipelineFrame | undefined;
  constructor() {
    this.worker.on('message', (message: WorkerOutput) => {
      if (this.failure || this.closing) return;
      if (message.type === 'ack') {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.state = message.state;
        if (pending.action === 'reset') { this.history.fill(undefined); this.cursor = 0; this.latest = undefined; }
        for (const listener of this.stateListeners) listener(this.state, pending.action === 'reset');
        clearTimeout(pending.timer); this.pending.delete(message.requestId); pending.resolve(message.state);
        return;
      }
      this.latest = message;
      // 历史只保留目标状态，不存重复网格；最多 600 帧，约一分钟。
      this.history[this.cursor] = { timestamp: message.frame.timestamp, fps: message.frame.fps, targets: message.frame.targets };
      this.cursor = (this.cursor + 1) % config.historyCapacity;
      for (const listener of this.listeners) listener(message);
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => { if (!this.closing) this.fail(new Error(`Pipeline worker exited: ${code}`)); });
  }
  private fail(error: Error): void {
    this.failure = error; this.state = 'failed'; this.latest = undefined;
    for (const listener of this.stateListeners) listener('failed', false);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  subscribe(listener: (message: PipelineFrame) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  subscribeState(listener: (state: 'playing' | 'paused' | 'failed', reset: boolean) => void): () => void { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener); }; }
  control(action: ControlAction): Promise<string> {
    if (this.failure || this.closing) return Promise.reject(this.failure ?? new Error('Service closing'));
    if (this.pending.size >= 32) return Promise.reject(new Error('Control queue full'));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Worker acknowledgement timeout')); }, 3000);
      this.pending.set(requestId, { action, resolve, reject, timer });
      this.worker.postMessage({ requestId, action });
    });
  }
  query(from: number, to: number, limit: number): FrameData[] {
    const result: FrameData[] = [];
    for (let i = 0; i < this.history.length && result.length < limit; i++) {
      const frame = this.history[(this.cursor + i) % this.history.length];
      if (frame && frame.timestamp >= from && frame.timestamp <= to) result.push(frame);
    }
    return result;
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Service closing')); }
    this.pending.clear(); this.listeners.clear(); this.stateListeners.clear();
    await this.worker.terminate();
  }
}
