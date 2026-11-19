import type {
  CalibrationPoint,
  FusionConfig,
  FusionObject,
  FusionPair,
  FusionSnapshot,
  RadarTarget
} from '@/types';
import { COPY } from '@/types';
import { DEFAULT_CALIBRATION_POINTS, isPointInPolygon } from '@/utils/calibration';

export type FusionDemoMode = 'ok' | 'expired' | 'uncalibrated';

export class FusionSimulator {
  private config: FusionConfig = {
    xMin: -20,
    xMax: 20,
    yMin: 0,
    yMax: 60,
    gridResolution: 1,
    maxAgeMs: 1500,
    alignWindowMs: 500,
    cameraOffsetMs: 0,
    extendRadarField: true,
    fieldScope: 'joint'
  };

  private calibration: CalibrationPoint[] | null = [...DEFAULT_CALIBRATION_POINTS];
  private demoMode: FusionDemoMode = 'ok';
  private radarDropped = 0;
  private tickCount = 0;

  setDemoMode(mode: FusionDemoMode): void {
    this.demoMode = mode;
    if (mode === 'uncalibrated') {
      this.calibration = null;
    } else if (!this.calibration) {
      this.calibration = [...DEFAULT_CALIBRATION_POINTS];
    }
  }

  getDemoMode(): FusionDemoMode {
    return this.demoMode;
  }

  setConfig(partial: Partial<FusionConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): FusionConfig {
    return { ...this.config };
  }

  setCalibration(points: CalibrationPoint[] | null): boolean {
    if (!points || points.length < 3) {
      this.calibration = null;
      this.demoMode = 'uncalibrated';
      return false;
    }
    this.calibration = points.map((p) => ({ ...p }));
    if (this.demoMode === 'uncalibrated') {
      this.demoMode = 'ok';
    }
    return true;
  }

  getCalibration(): CalibrationPoint[] | null {
    return this.calibration ? this.calibration.map((p) => ({ ...p })) : null;
  }

  buildSnapshot(activeRadarTargets: RadarTarget[]): FusionSnapshot {
    this.tickCount += 1;
    if (this.tickCount % 17 === 0) {
      this.radarDropped += 1;
    }
    const nowIso = new Date().toISOString();
    const gridWidth = 41;  // x: -20 .. 20
    const gridHeight = 13; // y: 0 .. 60 (step 5m)
    const xAxis = Array.from({ length: gridWidth }, (_, i) =>
      Number((this.config.xMin + (i * (this.config.xMax - this.config.xMin)) / (gridWidth - 1)).toFixed(2))
    );
    const yAxis = Array.from({ length: gridHeight }, (_, j) =>
      Number((this.config.yMin + (j * (this.config.yMax - this.config.yMin)) / (gridHeight - 1)).toFixed(2))
    );

    const calibrationValid = Boolean(this.calibration && this.calibration.length >= 3) && this.demoMode !== 'uncalibrated';

    // Handle 'expired' quality state explicitly
    if (this.demoMode === 'expired') {
      return {
        fieldAvailable: false,
        calibrationValid,
        radarFresh: false,
        visionFresh: false,
        timeMatched: false,
        liveEligible: false,
        status: 'expired',
        message: COPY.FUSION_EXPIRED,
        alignmentBasis: 'host_receive_utc_offset',
        modelVersion: 'anisotropic_kernel_v0.3.6',
        capturedUtc: nowIso,
        timeDifferenceMs: 1840,
        referenceLagMs: 1840,
        config: { ...this.config, fieldScope: 'unavailable' },
        gridWidth,
        gridHeight,
        xAxis,
        yAxis,
        displayField: null, // Strictly null when unavailable, never 0-filled
        validFieldMask: null,
        rawMax: 0,
        rawMean: 0,
        radarObjects: [],
        pedestrians: [],
        interactions: [],
        quality: [COPY.FUSION_EXPIRED, '观测滞后 > 1500ms，触发安全门控隐藏'],
        computeMs: 142,
        radarDropped: this.radarDropped,
        visionMergedCount: 0,
        calibration: this.calibration
      };
    }

    // Build radar objects from active targets (or synthetic fallback if radar not connected yet)
    const phase = this.tickCount * 0.15;
    const baseRadar: FusionObject[] =
      activeRadarTargets.length > 0
        ? activeRadarTargets.slice(0, 12).map((t) => ({
            id: `R-${t.id}`,
            kind: 'radar' as const,
            source: 'tcr300',
            x: t.x,
            y: t.y,
            vx: t.vx,
            vy: t.vy,
            confidence: 0.9,
            velocityKnown: true,
            observedUtc: t.receiveUtc,
            vendorClass: t.cls
          }))
        : [
            { id: 'R-101', kind: 'radar', source: 'tcr300', x: -3.2, y: 24 + Math.sin(phase) * 4, vx: 0.1, vy: -7.8, confidence: 0.94, velocityKnown: true, observedUtc: nowIso, vendorClass: 0 },
            { id: 'R-102', kind: 'radar', source: 'tcr300', x: 3.4, y: 18 + Math.cos(phase) * 5, vx: -0.1, vy: 8.5, confidence: 0.91, velocityKnown: true, observedUtc: nowIso, vendorClass: 0 },
            { id: 'R-105', kind: 'radar', source: 'tcr300', x: -6.8, y: 38 + Math.sin(phase * 0.7) * 6, vx: 0.0, vy: -9.2, confidence: 0.88, velocityKnown: true, observedUtc: nowIso, vendorClass: 1 },
            { id: 'R-108', kind: 'radar', source: 'tcr300', x: 6.5, y: 47 + Math.cos(phase * 0.8) * 4, vx: 0.2, vy: 6.4, confidence: 0.86, velocityKnown: true, observedUtc: nowIso, vendorClass: 0 }
          ];

    const candidatePedestrians: FusionObject[] = [
      { id: 'P-1', kind: 'pedestrian', source: 'vision_homography', x: -1.6 + Math.sin(phase) * 1.1, y: 15.5, vx: 1.1, vy: 0.2, confidence: 0.89, velocityKnown: true, observedUtc: nowIso, vendorClass: 0 },
      { id: 'P-2', kind: 'pedestrian', source: 'vision_homography', x: 2.2 + Math.cos(phase) * 0.9, y: 16.8, vx: -0.9, vy: 0.1, confidence: 0.86, velocityKnown: true, observedUtc: nowIso, vendorClass: 0 },
      { id: 'P-3', kind: 'pedestrian', source: 'vision_homography', x: 5.4, y: 22.0 + Math.sin(phase) * 0.8, vx: -0.4, vy: 0.8, confidence: 0.82, velocityKnown: true, observedUtc: nowIso, vendorClass: 0 },
      { id: 'P-4', kind: 'pedestrian', source: 'vision_homography', x: -14.5, y: 48.0, vx: 0.0, vy: 1.0, confidence: 0.79, velocityKnown: false, observedUtc: nowIso, vendorClass: 0 }
    ];

    // Pedestrians outside calibration polygon are strictly filtered out
    const pedestrians = calibrationValid
      ? candidatePedestrians.filter((p) => isPointInPolygon(p.x, p.y, this.calibration))
      : [];

    // Compute interactions (closest approach & TTC)
    const interactions: FusionPair[] = [];
    for (const r of baseRadar) {
      for (const p of pedestrians) {
        const dx = p.x - r.x;
        const dy = p.y - r.y;
        const dist = Math.hypot(dx, dy);
        const rvx = r.vx - p.vx;
        const rvy = r.vy - p.vy;
        const relSpeedSq = rvx * rvx + rvy * rvy;
        const dot = dx * rvx + dy * rvy;
        const closingSpeed = dist > 1e-3 ? Math.max(0, dot / dist) : 0;
        const ttc = relSpeedSq > 0.1 && dot > 0 ? Math.min(15, (dist * dist) / Math.max(0.1, dot)) : 12.5;
        const minDist = Math.max(0.5, Math.hypot(dx - rvx * Math.min(ttc, 5), dy - rvy * Math.min(ttc, 5)));
        const relRisk = Number(((1 / (0.6 + minDist * 0.35)) * (1 + closingSpeed * 0.18)).toFixed(2));
        if (dist < 28) {
          interactions.push({
            radarId: r.id,
            pedestrianId: p.id,
            timeToClosestSeconds: Number(ttc.toFixed(1)),
            closestDistanceMeters: Number(minDist.toFixed(1)),
            closingSpeedMps: Number(closingSpeed.toFixed(2)),
            relativeRisk: relRisk
          });
        }
      }
    }
    interactions.sort((a, b) => b.relativeRisk - a.relativeRisk);

    // Determine field availability and scope
    const fieldAvailable = calibrationValid || this.config.extendRadarField;
    const fieldScope: FusionConfig['fieldScope'] = !fieldAvailable
      ? 'unavailable'
      : calibrationValid
      ? 'joint'
      : 'radar_only';

    let displayField: number[] | null = null;
    let validFieldMask: boolean[] | null = null;
    let rawMax = 0;
    let rawSum = 0;

    if (fieldAvailable) {
      displayField = new Array(gridWidth * gridHeight);
      validFieldMask = new Array(gridWidth * gridHeight);

      for (let j = 0; j < gridHeight; j++) {
        const gy = yAxis[j];
        for (let i = 0; i < gridWidth; i++) {
          const gx = xAxis[i];
          const inCalib = calibrationValid && isPointInPolygon(gx, gy, this.calibration);
          const cellValid = inCalib || this.config.extendRadarField;
          validFieldMask[j * gridWidth + i] = cellValid;

          if (!cellValid) {
            displayField[j * gridWidth + i] = 0;
            continue;
          }

          let raw = 0;
          // Anisotropic Gaussian kernel for vehicles (beta_long = 0.20, beta_lat = 0.50, speed gain = 0.16)
          for (const r of baseRadar) {
            const speed = Math.hypot(r.vx, r.vy);
            const heading = speed > 0.2 ? Math.atan2(r.vx, r.vy) : 0;
            const dx = gx - r.x;
            const dy = gy - r.y;
            const dLong = dx * Math.sin(heading) + dy * Math.cos(heading);
            const dLat = dx * Math.cos(heading) - dy * Math.sin(heading);
            const effLong = Math.max(0, Math.abs(dLong) - 2.25); // 4.5m prior half-length
            const effLat = Math.max(0, Math.abs(dLat) - 0.9);    // 1.8m prior half-width
            const sigmaLong = 1 / (0.20 / (1 + 0.16 * speed));
            const sigmaLat = 1 / 0.50;
            const kernel = Math.exp(
              -(effLong * effLong) / (2 * sigmaLong * sigmaLong) -
                (effLat * effLat) / (2 * sigmaLat * sigmaLat)
            );
            raw += 1.45 * kernel;
          }

          // Pedestrian kernel (0.6x0.6m prior, only inside calibrated polygon)
          if (inCalib) {
            for (const p of pedestrians) {
              const dx = gx - p.x;
              const dy = gy - p.y;
              const distSq = dx * dx + dy * dy;
              raw += 0.95 * Math.exp(-distSq / (2 * 2.1 * 2.1));
            }
          }

          if (raw > rawMax) rawMax = raw;
          rawSum += raw;
          displayField[j * gridWidth + i] = Number((raw / (1 + raw)).toFixed(4));
        }
      }
    }

    const rawMean = fieldAvailable ? rawSum / (gridWidth * gridHeight) : 0;
    const computeMs = Math.round(135 + Math.abs(Math.sin(phase)) * 75);
    const timeDiff = Math.round(68 + Math.abs(Math.cos(phase)) * 85 + Math.abs(this.config.cameraOffsetMs) * 0.05);
    const timeMatched = timeDiff <= this.config.alignWindowMs;

    const quality: string[] = [];
    if (!calibrationValid) {
      quality.push(COPY.FUSION_EMPTY);
      if (this.config.extendRadarField) {
        quality.push('当前仅渲染雷达车辆先验场（fieldScope=radar_only）');
      }
    } else {
      quality.push(COPY.FUSION_CALIBRATED);
      if (!timeMatched) {
        quality.push(`时延差 ${timeDiff}ms 超出对齐容差 ${this.config.alignWindowMs}ms`);
      }
    }

    return {
      fieldAvailable,
      calibrationValid,
      radarFresh: true,
      visionFresh: true,
      timeMatched,
      liveEligible: calibrationValid && timeMatched,
      status: calibrationValid ? 'ok' : 'uncalibrated',
      message: calibrationValid ? COPY.FUSION_CALIBRATED : COPY.FUSION_EMPTY,
      alignmentBasis: 'host_receive_utc_offset',
      modelVersion: 'anisotropic_kernel_v0.3.6',
      capturedUtc: nowIso,
      timeDifferenceMs: timeDiff,
      referenceLagMs: 42,
      config: { ...this.config, fieldScope },
      gridWidth,
      gridHeight,
      xAxis,
      yAxis,
      displayField,
      validFieldMask,
      rawMax: Number(rawMax.toFixed(2)),
      rawMean: Number(rawMean.toFixed(3)),
      radarObjects: baseRadar,
      pedestrians,
      interactions,
      quality,
      computeMs,
      radarDropped: this.radarDropped,
      visionMergedCount: pedestrians.length + baseRadar.length,
      calibration: this.calibration
    };
  }
}
