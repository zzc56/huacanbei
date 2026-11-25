import type { Target } from '../types';

const visualCategories = new Map([
  ['car', '车辆'],
  ['vehicle', '车辆'],
  ['van', '厢式车'],
  ['truck', '货车'],
  ['bus', '客车'],
  ['bicycle', '自行车'],
  ['bike', '两轮车'],
  ['motorcycle', '摩托车'],
  ['person', '行人'],
  ['sports ball', '球'],
]);

export function targetCategory(target?: Target): string | undefined {
  const category = target?.camera?.class || target?.kind;
  if (category === 'sports ball') return category;
  if (target?.radar) return '车辆';
  return category && category !== 'unknown' ? category : undefined;
}

export function targetDisplayName(target?: Target, options?: { showVisualNumber: boolean }): string {
  if (!target) return '—';
  const category = targetCategory(target);
  const ballNumber = category === 'sports ball' ? /^BALL-(\d+)$/.exec(target.id)?.[1] : undefined;
  if (ballNumber) return `球 ${ballNumber}`;
  const radarId = category === 'sports ball' ? undefined : target.radar ? target.id : target.lastLinkedRadarId;
  if (radarId) return `车辆 ${radarId.replace(/^radar:/, '')}`;
  const name = category ? visualCategories.get(category.toLowerCase()) ?? category : target.camera ? '视觉目标' : '目标';
  if (target.measurementSource === 'vision-only' || target.measurementSource === 'recorded-vision') {
    return options?.showVisualNumber !== false && target.visualNumber !== undefined
      ? `${name} W${target.visualNumber}` : `未关联${name}`;
  }
  const number = target.camera?.trackId || target.id.replace(/^(?:vision|ped):/, '');
  return `${name} ${number}`;
}

export function cameraTargetIcon(target: Target): string {
  const category = target.camera?.class ?? target.kind;
  if (category === 'sports ball') return 'ball';
  if (category === 'truck' || category === 'person') return category;
  return target.camera ? 'car' : 'radar';
}
