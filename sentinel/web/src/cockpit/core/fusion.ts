import type { Target } from '../types';
export const degrees = (v: number) => ((v * 180) / Math.PI + 360) % 360;
/** 由已关联的世界坐标/速度解算分速度。正径向速度表示远离，正切向速度表示顺时针。 */
export function solveFusion(
  x: number,
  y: number,
  vx: number,
  vy: number,
) {
  const range = Math.max(Math.hypot(x, y), 0.001);
  return {
    x,
    y,
    vx,
    vy,
    speed: Math.hypot(vx, vy),
    heading: degrees(Math.atan2(vx, vy)),
    azimuth: degrees(Math.atan2(x, y)),
    radialVelocity: (vx * x + vy * y) / range,
    tangentialVelocity: (vx * y - vy * x) / range,
  };
}
/** Mock 高位道路摄像机投影；城市模型、车辆与检测框共用此变换。 */
export function cameraGround(x: number, y: number): [number, number] {
  const depth = (220 - y) / 220;
  return [0.5 + (x / 210) * (0.45 + depth * 0.55), 0.12 + depth * 0.79];
}
export function projectCamera(
  x: number,
  y: number,
  truck = false,
  person = false,
): [number, number, number, number] {
  const depth = (220 - y) / 220;
  const width = ((truck ? 0.065 : 0.044) * (0.45 + depth * 0.55) + 0.012) * (person ? 0.34 : 1);
  const height = width * (person ? 2.7 : truck ? 1.65 : 1.4);
  const [center, bottom] = cameraGround(x, y);
  return [center - width / 2, bottom - height, width, height];
}
export function interpolateTargets(a: Target[], b: Target[], t: number): Target[] {
  const previous = new Map(a.map((v) => [v.id, v]));
  return b.map((target) => {
    const old = previous.get(target.id);
    if (!old) return target;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    const f =
      old.fusion && target.fusion && old.fusion.vx !== null && old.fusion.vy !== null && target.fusion.vx !== null && target.fusion.vy !== null
        ? solveFusion(
            lerp(old.fusion.x, target.fusion.x),
            lerp(old.fusion.y, target.fusion.y),
            lerp(old.fusion.vx, target.fusion.vx),
            lerp(old.fusion.vy, target.fusion.vy),
          )
        : target.fusion;
    // 真实视觉框必须使用接口提供的标定结果，不能由 Mock 投影覆盖。
    const camera =
      target.camera && old.camera
        ? {
            ...target.camera,
            bbox: target.camera.bbox.map((v, i) => lerp(old.camera!.bbox[i], v)) as [
              number,
              number,
              number,
              number,
            ],
          }
        : target.camera;
    return { ...target, fusion: f, camera };
  });
}
