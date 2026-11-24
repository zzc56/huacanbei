import type { CameraFrameStore } from './camera.js';
import { calibratedPoint, type LiveCalibration } from './calibration.js';
import type { RadarObservation } from './tcr300.js';

type VisionFrame = NonNullable<ReturnType<CameraFrameStore['snapshot']>['vision']>;
type Observation = { time: number; x: number; y: number; trackStart: number | undefined };
type Alignment = { id: number; x: number; y: number; timeDeltaMs: number; timestamp: number; trackStart?: number };
const vehicleLabels = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'bike', 'van', 'vehicle']);
const positionGateM = 3;
const ambiguityMarginM = .6;

export class RadarTimeline {
  private readonly tracks = new Map<number, Observation[]>();

  clear() { this.tracks.clear(); }

  record(target: RadarObservation, time: number) {
    const { track_id, x_lateral: x, y_longitudinal: y } = target;
    const old = this.tracks.get(track_id);
    const last = old?.at(-1);
    const trackStart = target.track_start_seq;
    const series = old && last && last.trackStart === trackStart && time >= last.time && time - last.time <= 700 ? old : [];
    if (last?.time === time) series.pop();
    series.push({ time, x, y, trackStart });
    while (series.length > 128 || time - series[0]!.time > 6500) series.shift();
    this.tracks.set(track_id, series);
  }

  align(current: RadarObservation[], time: number, windowMs: number, interpolate = true): Alignment[] {
    const aligned: Alignment[] = [];
    for (const target of current) {
      const observations = this.tracks.get(target.track_id) ?? [];
      const track = target.track_start_seq === undefined ? {} : { trackStart: target.track_start_seq };
      let before: Observation | undefined;
      let after: Observation | undefined;
      for (const observation of observations) {
        if (observation.time <= time) before = observation;
        if (observation.time >= time) { after = observation; break; }
      }
      const priorAge = before ? time - before.time : Infinity;
      const nextAge = after ? after.time - time : Infinity;
      const nearest = priorAge <= nextAge ? before : after;
      const timeDeltaMs = Math.min(priorAge, nextAge);
      if (!nearest || timeDeltaMs > windowMs) continue;
      if (interpolate && before && after && before.time < after.time && priorAge <= windowMs && nextAge <= windowMs) {
        const ratio = priorAge / (after.time - before.time);
        aligned.push({ id: target.track_id, x: before.x + (after.x - before.x) * ratio,
          y: before.y + (after.y - before.y) * ratio, timeDeltaMs, timestamp: time, ...track });
      } else aligned.push({ id: target.track_id, x: nearest.x, y: nearest.y, timeDeltaMs, timestamp: nearest.time, ...track });
    }
    return aligned;
  }
}

export type LiveVehicleLink = {
  method: 'live-calibrated-position-v1';
  detectionIndex: number;
  visualTrackId: string;
  radarId: string;
  radarTrackStart?: number;
  distanceM: number;
  timeDeltaMs: number;
};

type Match = { detectionIndex: number; radarId: number; distanceM: number; timeDeltaMs: number; trackStart: number | undefined };

function duplicateBox(a: VisionFrame['detections'][number], b: VisionFrame['detections'][number]) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = width * height;
  return overlap >= .95 * (a.width * a.height + b.width * b.height - overlap);
}

export class LiveVehicleMatcher {
  private sequence = 0;
  private capturedAt = 0;
  private previous = new Map<string, { radarId: number; trackStart: number | undefined }>();
  private links: LiveVehicleLink[] = [];

  reset() {
    this.sequence = 0;
    this.capturedAt = 0;
    this.previous.clear();
    this.links = [];
  }

  match(vision: VisionFrame, radar: RadarObservation[], timeline: RadarTimeline, calibration: LiveCalibration, now: number) {
    if (vision.sequence < this.sequence) this.reset();
    if (vision.sequence === this.sequence) {
      this.links = this.links.filter(link => radar.some(target =>
        `radar:${target.track_id}` === link.radarId && target.track_start_seq === link.radarTrackStart,
      ));
      return this.links;
    }
    const capturedAt = Date.parse(vision.captured_utc);
    const alignedAt = capturedAt - calibration.settings.cameraOffsetMs;
    if (!Number.isFinite(alignedAt) || alignedAt > now) return [];
    const measurements = timeline.align(radar, alignedAt, calibration.settings.alignmentWindowMs);
    if (!measurements.length) return [];

    const detections = vision.detections.map((box, index) => ({ box, index })).sort((a, b) => b.box.score - a.box.score);
    const retained: typeof detections = [];
    for (const entry of detections) {
      if (!retained.some(other => duplicateBox(other.box, entry.box))) retained.push(entry);
    }
    const matches: Match[] = [];
    for (const { index, box } of retained) {
      if (!vehicleLabels.has(box.label.toLowerCase()) || box.y + box.height >= vision.height - 1) continue;
      const point = calibratedPoint(calibration, (box.x + box.width / 2) / vision.width, (box.y + box.height) / vision.height);
      if (!point) continue;
      for (const measurement of measurements) {
        const distanceM = Math.hypot(measurement.x - point.x, measurement.y - point.y);
        // A close runner-up outside the gate can still make the nearest point ambiguous.
        if (distanceM <= positionGateM + ambiguityMarginM) matches.push({ detectionIndex: index,
          radarId: measurement.id, distanceM, timeDeltaMs: measurement.timeDeltaMs, trackStart: measurement.trackStart });
      }
    }

    const elapsed = capturedAt - this.capturedAt;
    const previous = elapsed > 0 && elapsed <= 500 ? this.previous : undefined;
    const current = new Map<string, { radarId: number; trackStart: number | undefined }>();
    const links: LiveVehicleLink[] = [];
    for (const match of matches) {
      if (match.distanceM > positionGateM || matches.some(other => other !== match &&
        (other.detectionIndex === match.detectionIndex || other.radarId === match.radarId) &&
        other.distanceM < match.distanceM + ambiguityMarginM)) continue;
      const visualTrackId = vision.detections[match.detectionIndex]!.track_id;
      current.set(visualTrackId, match);
      const prior = previous?.get(visualTrackId);
      if (prior?.radarId === match.radarId && prior.trackStart === match.trackStart) links.push({ method: 'live-calibrated-position-v1',
        detectionIndex: match.detectionIndex, visualTrackId, radarId: `radar:${match.radarId}`,
        distanceM: match.distanceM, timeDeltaMs: match.timeDeltaMs,
        ...(match.trackStart !== undefined && { radarTrackStart: match.trackStart }) });
    }
    this.sequence = vision.sequence;
    this.capturedAt = capturedAt;
    this.previous = current;
    this.links = links;
    return links;
  }
}
