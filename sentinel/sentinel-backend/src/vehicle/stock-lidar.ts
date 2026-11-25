import type { StockLidarPreview, StockLidarSample } from './contracts.js';

const freshnessMs = 650;

export class StockLidarReader {
  private report: StockLidarPreview = { status: 'waiting', sample: null };
  private receivedMonoMs = 0;
  private lastCapture: { sequence: number; capturedTickMs: number } | undefined;
  private history: {sample:StockLidarSample; receivedMonoMs:number}[] = [];

  receive(payload: string, now: number, wallTime: number) {
    const fields = /^\{R(\d{1,10}):(\d{1,10}):([012]):(\d{1,4}):(-?\d{1,4})\}\$$/.exec(payload);
    if (!fields) return;
    const [sequence, capturedTickMs, status, distance, bearing] = fields.slice(1).map(Number) as [number, number, number, number, number];
    if (sequence > 0xffffffff || capturedTickMs > 0xffffffff) return;
    if (status === 2 ? distance < 100 || distance > 2000 || Math.abs(bearing) > 2000 : distance !== 0 || bearing !== 0) return;
    if (status === 0) {
      this.report = { status: 'offline', sample: null };
      this.history = [];
      return;
    }
    if (sequence === this.lastCapture?.sequence && capturedTickMs === this.lastCapture.capturedTickMs) return;
    this.lastCapture = { sequence, capturedTickMs };
    this.receivedMonoMs = now;
    const sample: StockLidarSample = {
      sequence, capturedTickMs, receivedAtMs: wallTime,
      nearest: status === 2 ? { rangeM: distance / 1000, bearingDeg: bearing / 100 } : null,
    };
    this.report = {status:'online',sample};
    this.history.unshift({sample,receivedMonoMs:now});
    if (this.history.length > 8) this.history.pop();
  }

  snapshot(now: number, maxAgeMs = freshnessMs): StockLidarPreview {
    if (this.report.status === 'online' && now - this.receivedMonoMs > maxAgeMs)
      return { status: 'stale', sample: null };
    return this.report;
  }

  recentScans(now: number, maxAgeMs: number): readonly StockLidarSample[] {
    if (this.snapshot(now, maxAgeMs).status !== 'online') return [];
    return this.history.filter(scan=>now - scan.receivedMonoMs <= maxAgeMs).map(scan=>scan.sample);
  }
}
