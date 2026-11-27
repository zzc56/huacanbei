import { wheelFeedbackMaxAgeMs, type GroundPose, type StockTelemetry, type VehiclePose } from './contracts.js';

type WheelSample = NonNullable<StockTelemetry['sample']>;
type Mileage = { time: number; distance: number; speed: number };

// The stock APP frames report speed magnitudes. Only the tested straight, forward motion is tracked.
export class StraightOdometry {
  private history: Mileage[];
  private valid = true;
  private mayBeCoasting = false;
  private sin: number;
  private cos: number;

  constructor(private origin: GroundPose, sample: WheelSample) {
    const angle = origin.headingDeg * Math.PI / 180;
    this.sin = Math.sin(angle);
    this.cos = Math.cos(angle);
    this.history = [{ time: sample.receivedAtMs, distance: 0, speed: 0 }];
  }

  update(sample: WheelSample | null, drivingForward: boolean) {
    if (!this.valid) return;
    if (!sample) { this.valid = false; return; }
    if (drivingForward) this.mayBeCoasting = true;
    const previous = this.history.at(-1)!;
    const interval = sample.receivedAtMs - previous.time;
    const speed = (sample.wheelAMps + sample.wheelBMps) / 2;
    if (interval < 0 || interval > wheelFeedbackMaxAgeMs ||
        (!this.mayBeCoasting && speed > 0) || Math.abs(sample.wheelAMps - sample.wheelBMps) > 0.18) {
      this.valid = false;
      return;
    }
    if (!interval) return;
    if (!drivingForward && speed === 0) this.mayBeCoasting = false;
    this.history.push({ time: sample.receivedAtMs, distance: previous.distance + (previous.speed + speed) * interval / 2000, speed });
    if (this.history.length > 12) this.history.shift();
  }

  poseAt(time: number): VehiclePose | undefined {
    const latest = this.history.at(-1)!;
    if (!this.valid || time - latest.time > wheelFeedbackMaxAgeMs) return;
    const earlier = this.history.findLast(entry => entry.time <= time);
    if (!earlier) return;
    const later = this.history.find(entry => entry.time > time);
    const elapsed = time - earlier.time;
    const speed = later ? earlier.speed + (later.speed - earlier.speed) * elapsed / (later.time - earlier.time) : earlier.speed;
    const distance = earlier.distance + (earlier.speed + speed) * elapsed / 2000;
    return { xM: this.origin.xM + this.sin * distance, yM: this.origin.yM + this.cos * distance,
      headingDeg: this.origin.headingDeg, speedMps: speed, capturedAtMs: time };
  }
}
