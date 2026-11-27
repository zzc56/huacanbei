import type { ScanPoint, StockLidarPreview, StockLidarSample } from './contracts.js';
import { stockLidarLimits } from './contracts.js';

const freshnessMs = 650;
const mergeDistanceM = 0.05;
const radians = Math.PI / 180;
const fragmentWidthM = 0.045;
const fragmentDepthM = 0.02;
const fragmentGapM = 0.02;
const displayDeadbandM = 0.015;
const closeRangeM = 0.15;
const closeSpanM = 0.08;
const closeDepthM = 0.006;
const contourRangeM = 0.32;

function separation(a: ScanPoint, b: ScanPoint) {
  const lateral = 2 * Math.sqrt(a.rangeM * b.rangeM) * Math.sin((a.bearingDeg - b.bearingDeg) * radians / 2);
  return Math.hypot(a.rangeM - b.rangeM, lateral);
}

function compactCenter(points: ScanPoint[]): ScanPoint {
  const bearings = points.map(point => point.bearingDeg);
  return {
    rangeM: points.reduce((sum, point) => sum + point.rangeM, 0) / points.length,
    bearingDeg: (Math.min(...bearings) + Math.max(...bearings)) / 2,
  };
}

interface EchoPosition { point: ScanPoint; xM: number; yM: number }

function echoPosition(point: ScanPoint): EchoPosition {
  const angle = point.bearingDeg * radians;
  return {point, xM:point.rangeM * Math.sin(angle), yM:point.rangeM * Math.cos(angle)};
}

function mergeNearbyEchoes(points: ScanPoint[], extended: boolean): ScanPoint[] {
  const ranked = points.map(echoPosition).sort((a,b) => a.yM - b.yM);
  const targets: typeof ranked = [];
  // Keep the earliest forward stop point in each group, even if a nearby echo has a shorter radial range.
  for (const point of ranked) {
    if (!targets.some(target => extended
      ? Math.round(Math.abs(point.point.rangeM - target.point.rangeM) * 1000) <= 15 &&
        Math.round(Math.abs(point.point.bearingDeg - target.point.bearingDeg) * 100) <= 15
      : Math.hypot(point.xM - target.xM, point.yM - target.yM) <= mergeDistanceM))
      targets.push(point);
  }
  return targets.map(({point}) => point).sort((a,b) => a.rangeM - b.rangeM);
}

function isNearContour(run: EchoPosition[]) {
  const ranges = run.map(({point}) => point.rangeM);
  const nearest = Math.min(...ranges), depth = Math.max(...ranges) - nearest;
  const first = run[0]!, last = run.at(-1)!;
  const width = last.xM - first.xM, rise = last.yM - first.yM;
  if (nearest < closeRangeM || nearest > contourRangeM || depth < 0.012 || depth > 0.114 ||
      width < 0.06 || Math.hypot(width, rise) > 0.173) return false;
  return run.every((point, index) => {
    const previous = run[index - 1];
    if (previous && (point.xM - previous.xM > 0.053 ||
        Math.hypot(point.xM - previous.xM, point.yM - previous.yM) > 0.072)) return false;
    const offset = point.yM - (first.yM + rise * (point.xM - first.xM) / width);
    return offset >= -0.06 && offset <= 0.03;
  });
}

interface NearContour {
  point: ScanPoint;
  minX: number;
  maxX: number;
  frontY: number;
  backY: number;
}

interface NearContourTrack {
  shape: NearContour;
  reference: NearContour;
  splitFrames: number;
  pending?: {shape: NearContour; frames: number};
}

// A slanted or curved front surface can span several compact runs. Require
// several samples along one bounded contour, keeping isolated returns separate.
function mergeNearContours(points: ScanPoint[]) {
  if (points.length < 3) return {targets:points, contours:[] as NearContour[]};
  const ordered = points.map(echoPosition).sort((a, b) => a.xM - b.xM);
  const targets: ScanPoint[] = [];
  const contours: NearContour[] = [];
  for (let start = 0; start < ordered.length;) {
    let end = ordered.length;
    while (end >= start + 3 && !isNearContour(ordered.slice(start, end))) --end;
    if (end < start + 3) {
      targets.push(ordered[start++]!.point);
      continue;
    }
    const profile = ordered.slice(start, end);
    const frontY = Math.min(...profile.map(point => point.yM));
    const front = profile.filter(point => point.yM - frontY <= 0.022);
    const x = (front[0]!.xM + front.at(-1)!.xM) / 2;
    const point = {rangeM: Math.min(...profile.map(({point}) => point.rangeM)), bearingDeg: Math.atan2(x, frontY) / radians};
    contours.push({point, minX:profile[0]!.xM, maxX:profile.at(-1)!.xM, frontY,
      backY:Math.max(...profile.map(p => p.yM))});
    targets.push(point);
    start = end;
  }
  return {targets, contours};
}

interface CompactSurface {
  first: ScanPoint;
  last: ScanPoint;
  observedAt: number;
}

function groupCompactReturns(points: ScanPoint[], previous: CompactSurface[], now: number) {
  const ordered = [...points].sort((a, b) => a.bearingDeg - b.bearingDeg);
  const runs: ScanPoint[][] = [];
  for (const point of ordered) {
    const run = runs.at(-1);
    if (run && separation(point, run.at(-1)!) <= fragmentGapM &&
        run.every(member => Math.abs(point.rangeM - member.rangeM) <= fragmentDepthM &&
          separation(point, member) <= (Math.max(point.rangeM, member.rangeM) <= closeRangeM ? closeSpanM : fragmentWidthM))) run.push(point);
    else runs.push([point]);
  }
  const surfaces: CompactSurface[] = [];
  const observations = runs.flatMap(run => {
    const first = run[0]!, last = run.at(-1)!;
    if (run.length >= 3) surfaces.push({first, last, observedAt: now});
    else {
      // A single observation can keep a known surface available for a sparse following scan.
      const matched = previous.find(surface => now - surface.observedAt <= freshnessMs && run.every(point =>
        Math.abs(point.rangeM - surface.first.rangeM) <= fragmentDepthM &&
        Math.abs(point.rangeM - surface.last.rangeM) <= fragmentDepthM &&
        separation(point, surface.first) <= fragmentWidthM && separation(point, surface.last) <= fragmentWidthM &&
        (point.bearingDeg >= surface.first.bearingDeg || separation(point, surface.first) <= fragmentGapM) &&
        (point.bearingDeg <= surface.last.bearingDeg || separation(point, surface.last) <= fragmentGapM)));
      if (!matched) return run;
      if (!surfaces.includes(matched)) surfaces.push(matched);
    }
    return run.length === 1 ? run : [compactCenter(run)];
  }).sort((a, b) => a.rangeM - b.rangeM);
  return {observations, surfaces};
}

interface DisplayTrack {
  id: number;
  measured: ScanPoint;
  display: ScanPoint;
  pendingNearBearing?: {point: ScanPoint; frames: number};
}

function stabilize(previous: number, current: number, deadband: number, blendLimit: number) {
  const difference = current - previous;
  if (Math.abs(difference) <= deadband + 1e-9) return previous;
  return Math.abs(difference) <= blendLimit ? previous + difference * 0.5 : current;
}

export class StockLidarReader {
  private report: StockLidarPreview = { status: 'waiting', sample: null };
  private receivedMonoMs = 0;
  private lastCapture: { sequence: number; capturedTickMs: number } | undefined;
  private history: {sample:StockLidarSample; receivedMonoMs:number}[] = [];
  private tracks: DisplayTrack[] = [];
  private surfaces: CompactSurface[] = [];
  private closeSurface: {center: ScanPoint; splitFrames: number} | undefined;
  private contourTrack: NearContourTrack | undefined;
  private nextTrackId = 1;

  private confirmCloseSplit(points: ScanPoint[], observations: ScanPoint[]) {
    const closePoints = points.filter(point => point.rangeM <= closeRangeM);
    const closeTargets = observations.filter(point => point.rangeM <= closeRangeM);
    const ranges = closePoints.map(point => point.rangeM);
    if (!closeTargets.length || !closePoints.length || Math.max(...ranges) - Math.min(...ranges) > closeDepthM ||
        !closePoints.every(point => closePoints.every(other => separation(point, other) <= closeSpanM))) {
      this.closeSurface = undefined;
      return observations;
    }
    if (closeTargets.length === 1) {
      this.closeSurface = {center:closeTargets[0]!, splitFrames:0};
      return observations;
    }
    const center = compactCenter(closePoints);
    const surface = this.closeSurface;
    if (!surface || separation(center, surface.center) > 0.025) {
      this.closeSurface = undefined;
      return observations;
    }
    // Confirm a new gap in a known very close surface over three fresh scans.
    surface.splitFrames = Math.min(3, surface.splitFrames + 1);
    return surface.splitFrames < 3 ? [center, ...observations.filter(point => point.rangeM > closeRangeM)] : observations;
  }

  private confirmContourSplit(points: ScanPoint[]) {
    const {targets, contours} = mergeNearContours(points);
    const shape = contours.sort((a, b) => a.frontY - b.frontY)[0];
    const previous = this.contourTrack;
    if (!shape) {
      this.contourTrack = undefined;
      return targets;
    }
    const track: NearContourTrack = {shape, reference:shape, splitFrames:0};
    this.contourTrack = track;
    if (!previous || Math.abs(previous.shape.frontY - shape.frontY) > 0.03 ||
        Math.min(previous.shape.maxX, shape.maxX) - Math.max(previous.shape.minX, shape.minX) < 0.04) return targets;

    track.reference = previous.reference;
    if (Math.abs(shape.minX - track.reference.minX) > 0.02 || Math.abs(shape.frontY - track.reference.frontY) > 0.015) {
      const pending = previous.pending;
      const frames = pending && Math.abs(shape.minX - pending.shape.minX) <= 0.01 &&
        Math.abs(shape.frontY - pending.shape.frontY) <= 0.01 ? pending.frames + 1 : 1;
      if (frames >= 3) track.reference = shape;
      else track.pending = {shape, frames};
    }

    const minX = Math.min(shape.minX, previous.shape.minX) - 0.018;
    const maxX = Math.max(shape.maxX, previous.shape.maxX) + 0.025;
    const backY = Math.max(shape.backY, previous.shape.backY) + 0.07;
    const isolated = targets.filter(point => !contours.some(contour => contour.point === point)).filter(point => {
      const {xM, yM} = echoPosition(point);
      return point.rangeM <= shape.point.rangeM + 0.115 && xM >= minX && xM <= maxX && yM <= backY && yM >= shape.frontY - 0.015;
    });
    if (isolated.length) track.splitFrames = Math.min(3, previous.splitFrames + 1);
    const confirmed = track.splitFrames < 3 ? targets.filter(point => !isolated.includes(point)) : targets;
    return confirmed.map(point => point === shape.point ? track.reference.point : point);
  }

  private updateDisplayObservations(points: ScanPoint[]) {
    const pairs = this.tracks.flatMap(track => points.flatMap((point, index) => {
      const angleGate = Math.max(1.5, Math.atan2(fragmentWidthM, point.rangeM) / radians);
      const cost = Math.hypot((point.rangeM - track.measured.rangeM) / 0.18,
        (point.bearingDeg - track.measured.bearingDeg) / angleGate);
      return cost <= 1 ? [{ track, index, cost }] : [];
    })).sort((a, b) => a.cost - b.cost);
    const matched = new Map<number, DisplayTrack>();
    const usedTracks = new Set<number>();
    for (const { track, index } of pairs) {
      if (matched.has(index) || usedTracks.has(track.id)) continue;
      matched.set(index, track);
      usedTracks.add(track.id);
    }
    this.tracks = points.map((point, index) => {
      const previous = matched.get(index);
      const id = previous?.id ?? this.nextTrackId++;
      const display: ScanPoint = { ...point, trackId: `L${id}` };
      let pendingNearBearing: DisplayTrack['pendingNearBearing'];
      if (previous) {
        if (separation(previous.display, point) <= displayDeadbandM) {
          display.rangeM = previous.display.rangeM;
          display.bearingDeg = previous.display.bearingDeg;
        } else {
          display.rangeM = stabilize(previous.display.rangeM, point.rangeM, displayDeadbandM, 0.04);
          if (Math.max(previous.display.rangeM, point.rangeM) <= contourRangeM) {
            const lateralStep = separation({rangeM:point.rangeM, bearingDeg:previous.display.bearingDeg}, point);
            if (lateralStep <= displayDeadbandM) display.bearingDeg = previous.display.bearingDeg;
            else if (lateralStep <= 0.035) {
              const pending = previous.pendingNearBearing;
              const frames = pending && separation(pending.point, point) <= 0.01 ? pending.frames + 1 : 1;
              if (frames < 3) {
                display.bearingDeg = previous.display.bearingDeg;
                pendingNearBearing = {point, frames};
              }
            }
          } else {
            const angleDeadband = Math.max(0.15, Math.atan2(0.008, point.rangeM) / radians);
            display.bearingDeg = stabilize(previous.display.bearingDeg, point.bearingDeg, angleDeadband, angleDeadband * 4);
          }
        }
      }
      return { id, measured: point, display, ...(pendingNearBearing && {pendingNearBearing}) };
    }).sort((a, b) => a.id - b.id);
    return this.tracks.map(track => track.display);
  }

  receive(payload: string, now: number, wallTime: number) {
    const extended = payload.startsWith('{RN');
    const multiple = /^\{R[MN](\d{1,10}):(\d{1,10}):(-1|[0-6])((?::\d{1,5}:-?\d{1,4}){0,6})\}\$$/.exec(payload);
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
    const maxRangeM = extended ? stockLidarLimits.maxRangeM : stockLidarLimits.legacyMaxRangeM;
    const echoes: ScanPoint[] = [];
    for (let i = 0; i < values.length; i += 2) {
      const distance = values[i]!, bearing = values[i + 1]!;
      if (distance < stockLidarLimits.minRangeM * 1000 || distance > maxRangeM * 1000 ||
          Math.abs(bearing) > stockLidarLimits.halfSectorDeg * 100) return;
      echoes.push({ rangeM: distance / 1000, bearingDeg: bearing / 100 });
    }
    if (count < 0) {
      this.report = { status: 'offline', sample: null };
      this.history = [];
      this.tracks = [];
      this.surfaces = [];
      this.closeSurface = undefined;
      this.contourTrack = undefined;
      return;
    }
    if (sequence === this.lastCapture?.sequence && capturedTickMs === this.lastCapture.capturedTickMs) return;
    if (now - this.receivedMonoMs > 450 || maxRangeM !== this.report.maxRangeM) {
      this.tracks = [];
      this.surfaces = [];
      this.closeSurface = undefined;
      this.contourTrack = undefined;
    }
    this.lastCapture = { sequence, capturedTickMs };
    this.receivedMonoMs = now;
    let observations = mergeNearbyEchoes(echoes, extended);
    let brakingObservations: ScanPoint[] | undefined;
    if (extended) {
      const contours = this.confirmContourSplit(observations);
      const grouped = groupCompactReturns(contours, this.surfaces, now);
      const confirmed = this.confirmCloseSplit(contours, grouped.observations);
      if (confirmed.length < observations.length) brakingObservations = echoes;
      observations = confirmed;
      this.surfaces = grouped.surfaces;
    }
    const sample: StockLidarSample = {
      sequence, capturedTickMs, receivedAtMs: wallTime,
      observations,
      ...(brakingObservations && {brakingObservations}),
      nearest: echoes.reduce<StockLidarSample['nearest']>((nearest, point) =>
        !nearest || point.rangeM < nearest.rangeM ? point : nearest, null),
    };
    this.report = { status: 'online', sample, maxRangeM, displayObservations: this.updateDisplayObservations(sample.observations) };
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
