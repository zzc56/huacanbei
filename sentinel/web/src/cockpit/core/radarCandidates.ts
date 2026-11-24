import type { Frame, RadarCandidate, Target } from '../types';

type Sample = { time: number; value: number };
const historyMs = 3000;
export const radarCandidateTimeWindowMs = 160;
export const reviewedCandidateWindowMs = 750;
export const radarCandidateConfirmation = { minConfidence: 85, minLead: 10 } as const;
export function isRadarObservationAligned(frame: Frame, radar: Target) {
  const observedAt = radar.observationTimestamp;
  const cameraTime = frame.cameraFrame?.timestamp;
  return observedAt !== undefined && cameraTime !== undefined && observedAt <= frame.timestamp &&
    Math.abs(cameraTime - observedAt) <= radarCandidateTimeWindowMs;
}

// This is an evidence score. Nearby timing and correlated motion also occur
// between different vehicles, so those signals alone cannot confirm an ID.
export function radarCandidateConfidence(frame: Frame, radar: Target, candidate: RadarCandidate) {
  if (!isRadarObservationAligned(frame, radar)) return 0;
  const elapsed = Math.abs(frame.cameraFrame!.timestamp - radar.observationTimestamp!);
  const timing = 1 - elapsed / radarCandidateTimeWindowMs;
  if (candidate.reviewedTrackGapMs !== undefined) {
    const continuity = Math.max(0, Math.min(1, 1 - candidate.reviewedTrackGapMs / reviewedCandidateWindowMs));
    return Math.round(87 + 8 * timing + 5 * continuity);
  }
  const motion = candidate.motion;
  const motionScore = motion ? 44 * Math.max(0, Math.min(1, (motion.correlation - .85) / .15)) * Math.min(1, motion.samples / 12) : 0;
  return Math.round(15 + 20 * timing + motionScore);
}

type ScoredCandidate = { visualId: string; radarId: string; confidence: number };

export function confidentRadarPairs<T extends ScoredCandidate>(candidates: readonly T[]) {
  const { minConfidence, minLead } = radarCandidateConfirmation;
  return candidates.filter(candidate => candidate.confidence >= minConfidence && candidates.every(other =>
    other === candidate || (other.visualId !== candidate.visualId && other.radarId !== candidate.radarId) ||
    candidate.confidence - other.confidence >= minLead,
  ));
}

const vehicles = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'bike', 'van', 'vehicle']);

export function supportsRadarCandidates(category: string) {
  return vehicles.has(category.toLowerCase());
}

function addSample(tracks: Map<string, Sample[]>, id: string, time: number, value: number) {
  let series = tracks.get(id);
  const last = series?.at(-1);
  if (last && time - last.time < 60) return;
  if (!series || (last && time - last.time > 700)) {
    series = [];
    tracks.set(id, series);
  }
  series.push({ time, value });
  while (series[0].time < time - historyMs) series.shift();
}

// A fixed camera sees a usable vehicle box get smaller as range increases. This
// compares temporal changes only, without inferring a distance from box size.
function compareMotion(camera: Sample[], radar: Sample[], cutoff: number): RadarCandidate['motion'] {
  if (camera.length < 6 || radar.length < 6) return;
  let radarIndex = 0;
  const pairs: { time: number; heightInverse: number; range: number }[] = [];
  for (const observation of camera) {
    if (observation.time < cutoff) continue;
    while (radarIndex + 1 < radar.length &&
      Math.abs(radar[radarIndex + 1].time - observation.time) <= Math.abs(radar[radarIndex].time - observation.time)) radarIndex++;
    const nearest = radar[radarIndex];
    if (!nearest) break;
    if (Math.abs(nearest.time - observation.time) > radarCandidateTimeWindowMs) continue;
    pairs.push({ time: observation.time, heightInverse: observation.value, range: nearest.value });
    radarIndex++;
  }
  const samples = pairs.length;
  if (samples < 6 || pairs[samples - 1].time - pairs[0].time < 700) return;
  const heights = pairs.map((pair) => pair.heightInverse);
  const ranges = pairs.map((pair) => pair.range);
  if (Math.max(...ranges) - Math.min(...ranges) < 4 || Math.max(...heights) / Math.min(...heights) < 1.12) return;
  const meanHeight = heights.reduce((sum, value) => sum + value, 0) / samples;
  const meanRange = ranges.reduce((sum, value) => sum + value, 0) / samples;
  let covariance = 0;
  let heightVariance = 0;
  let rangeVariance = 0;
  for (const pair of pairs) {
    const height = pair.heightInverse - meanHeight;
    const range = pair.range - meanRange;
    covariance += height * range;
    heightVariance += height * height;
    rangeVariance += range * range;
  }
  const correlation = covariance / Math.sqrt(heightVariance * rangeVariance);
  return correlation >= 0.90 ? { samples, correlation } : undefined;
}

export class RadarCandidateTracker {
  private readonly visualTracks = new Map<string, Sample[]>();
  private readonly radarTracks = new Map<string, Sample[]>();
  private lastFrameTime = -Infinity;
  private liveSession: number | undefined;
  private liveCameraFrame: number | undefined;

  reset() {
    this.visualTracks.clear();
    this.radarTracks.clear();
    this.lastFrameTime = -Infinity;
    this.liveSession = undefined;
    this.liveCameraFrame = undefined;
  }

  update(frame: Frame) {
    const session = frame.live?.startedAt;
    const sequence = frame.live && frame.cameraFrame?.sequence;
    if (frame.timestamp < this.lastFrameTime || session !== this.liveSession ||
      (sequence !== undefined && this.liveCameraFrame !== undefined && sequence < this.liveCameraFrame)) this.reset();
    this.lastFrameTime = frame.timestamp;
    this.liveSession = session;
    if (sequence !== undefined) this.liveCameraFrame = sequence;
    const cutoff = frame.timestamp - historyMs;
    for (const tracks of [this.visualTracks, this.radarTracks]) {
      for (const [id, series] of tracks) if (series[series.length - 1].time < cutoff) tracks.delete(id);
    }

    const radars = frame.targets.flatMap((target) => {
      const time = target.observationTimestamp;
      if (!target.radar || time === undefined || !Number.isFinite(time) || !Number.isFinite(target.radar.range)) return [];
      addSample(this.radarTracks, target.id, time, target.radar.range);
      // Keep an existing linked target reserved for its own visual observation.
      return target.camera ? [] : [{ id: target.id, time }];
    });
    const cameraTime = frame.cameraFrame?.timestamp;
    if (cameraTime === undefined || !Number.isFinite(cameraTime)) return;
    for (const target of frame.targets) {
      const camera = target.camera;
      if (!camera || target.radar || !supportsRadarCandidates(camera.class)) continue;
      const [, top, , height] = camera.bbox;
      const trackId = camera.trackId;
      if (trackId && height >= 0.025 && top > 0.01 && top + height < 0.99) {
        addSample(this.visualTracks, trackId, cameraTime, 1 / height);
      }
      const series = trackId ? this.visualTracks.get(trackId) : undefined;
      const candidates: RadarCandidate[] = [];
      for (const radar of radars) {
        const history = this.radarTracks.get(radar.id) ?? [];
        // Inference can arrive after newer radar observations. Compare against
        // the acquisition time, while still requiring a currently tracked radar ID.
        const timeDeltaMs = history.reduce((closest, sample) => {
          const delta = cameraTime - sample.time;
          return Math.abs(delta) < Math.abs(closest) ? delta : closest;
        }, cameraTime - radar.time);
        if (Math.abs(timeDeltaMs) > radarCandidateTimeWindowMs) continue;
        const motion = series && compareMotion(series, history, cutoff);
        candidates.push({ radarId: radar.id, timeDeltaMs, ...(motion && { motion }) });
      }
      target.radarCandidates = candidates.sort((a, b) =>
        (b.motion?.correlation ?? 0) - (a.motion?.correlation ?? 0) || Math.abs(a.timeDeltaMs) - Math.abs(b.timeDeltaMs),
      );
    }
  }
}
