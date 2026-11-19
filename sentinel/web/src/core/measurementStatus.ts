import type { Target } from '../cockpit/types';

/** Explain absent values without confusing detection confidence with association. */
export function measurementStatus(target?: Target) {
  if(!target)return {source:'暂无观测',position:'暂无定位',velocity:'暂无速度',detail:'请选择一个当前目标'};
  if(target.autoAssociation){
    const a=target.autoAssociation,held=a.status==='held';
    return {source:held?'关联保持 · 待确认':'自动关联 · 待确认',position:'关联雷达定位',
      velocity:held?`雷达观测 ${(a.radarAgeMs/1000).toFixed(1)}s 前`:'关联雷达速度',
      detail:`${a.visualTrackId} → ${a.radarId}，${a.samples} 帧证据，关联评分 ${a.score.toFixed(2)}（不是概率），位置偏差中位数 ${a.medianDistance.toFixed(1)}m。自动关联尚未人工核实；角度和速度来自该雷达记录。`};
  }
  if(target.camera && !target.fusion && !target.radar)return {
    source:'视觉检测 · 未关联',position:'未关联空间定位',velocity:'未关联，暂无速度',
    detail:'已收到类别、检测框和置信度，但没有对应的雷达或已定位视觉轨迹；方位角和速度保持未知。',
  };
  const unknown=target.fusion?.vx===null || target.fusion?.vy===null || target.fusion?.speed===null;
  const recordedPedestrian=target.measurementSource==='recorded-vision';
  return {
    source:target.radar ? target.camera?'雷视融合':'雷达实测' : recordedPedestrian?'已关联行人轨迹':'视觉定位',
    position:target.radar?'雷达定位':'视觉地面投影',
    velocity:unknown?'原记录未提供速度':target.radar?'雷达速度分解':'视觉轨迹估计',
    detail:unknown?'该目标已有位置和方位角，但原始记录未提供有效速度，不能将未知速度填为 0。':target.radar?'距离、方位角及速度来自该雷达 ID 的记录。':recordedPedestrian?'位置与速度来自同帧、同 ID 的已保存行人轨迹；不是车辆雷视关联。':'位置与速度来自该视觉目标的轨迹。',
  };
}
