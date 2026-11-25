import type { ScanPoint, StockLidarPreview, StockLidarSample } from './contracts.js';

const freshnessMs = 650;
const mergeDistanceM = 0.05;

function mergeNearbyEchoes(points: ScanPoint[]): ScanPoint[] {
  const ranked = points.map(point => {
    const angle = point.bearingDeg * Math.PI / 180;
    return { point, xM:point.rangeM * Math.sin(angle), yM:point.rangeM * Math.cos(angle) };
  }).sort((a,b) => a.yM - b.yM);
  const targets: typeof ranked = [];
  // Keep the earliest forward stop point in each group, even if a nearby echo has a shorter radial range.
  for (const point of ranked) {
    if (!targets.some(target => Math.hypot(point.xM - target.xM, point.yM - target.yM) <= mergeDistanceM))
      targets.push(point);
  }
  return targets.map(({point}) => point).sort((a,b) => a.rangeM - b.rangeM);
}

export class StockLidarReader {
  private report: StockLidarPreview = { status: 'waiting', sample: null };
  private receivedMonoMs = 0;
  private lastCapture: { sequence: number; capturedTickMs: number } | undefined;
  private history: {sample:StockLidarSample; receivedMonoMs:number}[] = [];

  receive(payload: string, now: number, wallTime: number) {
    const multiple = /^\{RM(\d{1,10}):(\d{1,10}):(-1|[0-6])((?::\d{1,4}:-?\d{1,4}){0,6})\}\$$/.exec(payload);
    const legacy = /^\{R(\d{1,10}):(\d{1,10}):([012]):(\d{1,4}):(-?\d{1,4})\}\$$/.exec(payload);
    const fields = multiple ?? legacy;
    if (!fields) return;
    const sequence = Number(fields[1]), capturedTickMs = Number(fields[2]);
    const status = Number(fields[3]);
    if (sequence > 0xffffffff || capturedTickMs > 0xffffffff) return;
    const values = multiple
      ? fields[4]!.split(':').slice(1).map(Number)
      : status === 2 ? [Number(fields[4]), Number(fields[5])] : [];
    const count = multiple ? status : status - 1;
    if (values.length !== Math.max(0, count) * 2 ||
        (legacy && status !== 2 && (Number(fields[4]) !== 0 || Number(fields[5]) !== 0))) return;
    const echoes: ScanPoint[] = [];
    for (let i = 0; i < values.length; i += 2) {
      const distance = values[i]!, bearing = values[i + 1]!;
      if (distance < 100 || distance > 2000 || Math.abs(bearing) > 2000) return;
      echoes.push({ rangeM: distance / 1000, bearingDeg: bearing / 100 });
    }
    if (count < 0) {
      this.report = { status: 'offline', sample: null };
      this.history = [];
      return;
    }
    if (sequence === this.lastCapture?.sequence && capturedTickMs === this.lastCapture.capturedTickMs) return;
    this.lastCapture = { sequence, capturedTickMs };
    this.receivedMonoMs = now;
    const sample: StockLidarSample = {
      sequence, capturedTickMs, receivedAtMs: wallTime,
      observations: mergeNearbyEchoes(echoes),
      nearest: echoes.reduce<StockLidarSample['nearest']>((nearest, point) =>
        !nearest || point.rangeM < nearest.rangeM ? point : nearest, null),
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
