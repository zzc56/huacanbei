import { config } from '../config.js';
import type { CameraObservation, Covariance, FusionResult, RadarObservation, SensorBatch, SourceTag, Target } from '../contracts.js';

interface Point { x: number; y: number; covariance: Covariance }
interface Measurement extends Point { radar?: RadarObservation; camera?: CameraObservation; tag: SourceTag }
interface Track extends Point { id: string; timestamp: number; vx: number; vy: number; hits: number }
const rad = Math.PI / 180;
export const degrees = (x: number, y: number): number => (Math.atan2(x, y) / rad + 360) % 360;
function add(a: Covariance, b: Covariance): Covariance { return { xx: a.xx + b.xx, xy: a.xy + b.xy, yy: a.yy + b.yy }; }
function inverse(c: Covariance): Covariance {
  const det = c.xx * c.yy - c.xy * c.xy;
  if (det <= 1e-10) throw new RangeError('Covariance must be positive definite');
  return { xx: c.yy / det, xy: -c.xy / det, yy: c.xx / det };
}
function multiply(c: Covariance, x: number, y: number): [number, number] { return [c.xx * x + c.xy * y, c.xy * x + c.yy * y]; }
function validCovariance(c: Covariance): boolean {
  return [c.xx, c.xy, c.yy].every(Number.isFinite) && c.xx > 0 && c.yy > 0 && c.xx * c.yy - c.xy ** 2 > 1e-10;
}
/** d² = (z₁-z₂)ᵀ (P₁+P₂)⁻¹ (z₁-z₂)，在统一地面坐标比较，不比较像素与米。 */
export function mahalanobis(a: Point, b: Point): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  const [px, py] = multiply(inverse(add(a.covariance, b.covariance)), dx, dy);
  return dx * px + dy * py;
}
/** 独立高斯观测的信息滤波解：P=(Pᵣ⁻¹+P𝚌⁻¹)⁻¹，z=P(Pᵣ⁻¹zᵣ+P𝚌⁻¹z𝚌)。 */
function combine(a: Point, b: Point): Point {
  const ai = inverse(a.covariance), bi = inverse(b.covariance);
  const covariance = inverse(add(ai, bi));
  const av = multiply(ai, a.x, a.y), bv = multiply(bi, b.x, b.y);
  const [x, y] = multiply(covariance, av[0] + bv[0], av[1] + bv[1]);
  return { x, y, covariance };
}
export function projectCamera(c: CameraObservation): Point | undefined {
  const [left, top, width, height] = c.bbox, k = config.camera;
  const groundPixel = top + height - k.cy;
  if (![left, top, width, height, c.confidence].every(Number.isFinite) || width <= 0 || height <= 0 || groundPixel <= 1 || c.confidence < 0.3 || c.confidence > 1 || !validCovariance(c.covariance)) return undefined;
  // 水平针孔相机，光轴朝北。地面脚点 v=cy+fH/y，u=cx+fx/y。
  // 实机必须以真实内外参/地面单应性替换；单靠 BBox 不能无标定恢复米制深度。
  const y = k.focal * k.heightMeters / groundPixel;
  return { x: (left + width / 2 - k.cx) * y / k.focal, y, covariance: c.covariance };
}
export class FusionEngine {
  private tracks: Track[] = [];
  private sequence = 0;
  reset(): void { this.tracks = []; this.sequence = 0; }
  update(batch: SensorBatch): FusionResult {
    if (!Number.isFinite(batch.timestamp) || batch.radar.length > config.maxTargets || batch.camera.length > config.maxTargets) throw new RangeError('Invalid sensor batch');
    const fresh = (t: number): boolean => Number.isFinite(t) && t <= batch.timestamp && batch.timestamp - t <= config.maxAgeMs;
    const radar = batch.radar.filter(r => fresh(r.timestamp) && [r.range, r.azimuth, r.radialVelocity].every(Number.isFinite) && r.range > 0 && r.range <= config.radarMaxRange && validCovariance(r.covariance)).map(r => ({ observation: r, point: { x: r.range * Math.sin(r.azimuth * rad), y: r.range * Math.cos(r.azimuth * rad), covariance: r.covariance } }));
    const camera = batch.camera.flatMap(c => {
      const point = fresh(c.timestamp) ? projectCamera(c) : undefined;
      return point ? [{ observation: c, point }] : [];
    });
    const candidates: { r: number; c: number; cost: number }[] = [];
    for (const [r, a] of radar.entries()) for (const [c, b] of camera.entries()) {
      const delta = Math.abs(a.observation.timestamp - b.observation.timestamp);
      if (delta > config.alignmentMs) continue;
      // 时间差带来未知运动误差，以 15 m/s 的先验速度尺度增加协方差。
      // 真实高速场景应先由适配器/跟踪器去畸变，不能用放大门限替代时间同步。
      const variance = (15 * delta / 1000) ** 2;
      const cost = mahalanobis(a.point, { ...b.point, covariance: add(b.point.covariance, { xx: variance, xy: 0, yy: variance }) });
      if (cost < config.mahalanobisGate) candidates.push({ r, c, cost });
    }
    // 马氏距离全局排序后的贪心一对一门控；有界 O(N² log N)，不是匈牙利最优匹配。
    // 适合稀疏演示场景；密集交叉轨迹应替换为带虚拟未匹配节点的全局分配。
    candidates.sort((a, b) => a.cost - b.cost);
    const usedRadar = new Set<number>(), usedCamera = new Set<number>();
    const measurements: Measurement[] = [];
    for (const pair of candidates) {
      if (usedRadar.has(pair.r) || usedCamera.has(pair.c)) continue;
      const a = radar[pair.r]!, b = camera[pair.c]!;
      measurements.push({ ...combine(a.point, b.point), radar: a.observation, camera: b.observation, tag: 'fused' });
      usedRadar.add(pair.r); usedCamera.add(pair.c);
    }
    radar.forEach((a, i) => { if (!usedRadar.has(i)) measurements.push({ ...a.point, radar: a.observation, tag: 'radar_only' }); });
    camera.forEach((b, i) => { if (!usedCamera.has(i)) measurements.push({ ...b.point, camera: b.observation, tag: 'vision_only' }); });
    this.tracks = this.tracks.filter(t => batch.timestamp - t.timestamp <= config.trackTtlMs && t.timestamp < batch.timestamp);
    const trackPairs: { m: number; t: number; cost: number }[] = [];
    for (const [m, z] of measurements.entries()) for (const [t, old] of this.tracks.entries()) {
      const dt = (batch.timestamp - old.timestamp) / 1000;
      const variance = 0.5 + (2 * dt) ** 2;
      const prediction: Point = { x: old.x + old.vx * dt, y: old.y + old.vy * dt, covariance: add(old.covariance, { xx: variance, xy: 0, yy: variance }) };
      const cost = mahalanobis(prediction, z);
      if (cost < config.mahalanobisGate) trackPairs.push({ m, t, cost });
    }
    trackPairs.sort((a, b) => a.cost - b.cost);
    const assignment = new Map<number, Track>(), usedTracks = new Set<number>();
    for (const p of trackPairs) if (!assignment.has(p.m) && !usedTracks.has(p.t)) { assignment.set(p.m, this.tracks[p.t]!); usedTracks.add(p.t); }
    const result: FusionResult = { targets: [], statuses: [] };
    const next: Track[] = this.tracks.filter((_, i) => !usedTracks.has(i));
    for (const [i, m] of measurements.entries()) {
      const old = assignment.get(i), dt = old ? (batch.timestamp - old.timestamp) / 1000 : 0;
      let vx = old ? 0.7 * old.vx + 0.3 * (m.x - old.x) / dt : 0;
      let vy = old ? 0.7 * old.vy + 0.3 * (m.y - old.y) / dt : 0;
      const range = Math.max(1e-6, Math.hypot(m.x, m.y)), ux = m.x / range, uy = m.y / range;
      if (m.radar) {
        // 多普勒只约束沿视线速度；用残差投影修正，不凭单帧虚构切向信息。
        const residual = m.radar.radialVelocity - (vx * ux + vy * uy);
        vx += residual * ux; vy += residual * uy;
      }
      const track: Track = { x: m.x, y: m.y, covariance: m.covariance, id: old?.id ?? `T${++this.sequence}`, timestamp: batch.timestamp, vx, vy, hits: (old?.hits ?? 0) + 1 };
      next.push(track);
      const target: Target = { id: track.id, fusion: { x: m.x, y: m.y, speed: Math.hypot(vx, vy), heading: degrees(vx, vy), azimuth: degrees(m.x, m.y), radialVelocity: vx * ux + vy * uy, tangentialVelocity: vx * uy - vy * ux }, risk: { value: 0, level: 'low' } };
      if (m.radar) target.radar = { range: m.radar.range, azimuth: m.radar.azimuth, radialVelocity: m.radar.radialVelocity };
      if (m.camera) target.camera = { bbox: m.camera.bbox, class: m.camera.class, confidence: m.camera.confidence };
      result.targets.push(target); result.statuses.push({ id: track.id, tag: m.tag, velocityValid: track.hits >= 3 });
    }
    this.tracks = next.slice(-config.maxTargets * 2);
    return result;
  }
}
