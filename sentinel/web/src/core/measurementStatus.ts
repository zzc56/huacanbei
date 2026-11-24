import type { Target } from '../cockpit/types';

/** Explain absent values without confusing detection confidence with association. */
export function measurementStatus(target?: Target) {
  if(!target)return {source:'暂无观测',position:'暂无定位',velocity:'暂无速度',detail:'请选择一个当前目标'};
  const a = target.autoAssociation;
  if (a?.method === 'live-calibrated-position-v1') {
    return {
      source: '实时雷视关联', position: '雷达定位', velocity: '雷达实测速度',
      detail: `雷视对齐的位置偏差 ${a.distanceM.toFixed(2)} m，对齐时间差 ${Math.round(a.timeDeltaMs)} ms。位置与速度来自雷达点迹。`,
    };
  }
  if (a?.method === 'replay-candidate' && a.basis === 'adjacent-observation') {
    return {
      source: '雷视关联 · 邻帧雷达', position: '邻帧雷达定位', velocity: '邻帧雷达实测速度',
      detail: `雷达和画面的采集时间相差 ${Math.abs(a.timeDeltaMs)} ms。场值从当前画面的风险场读取。`,
    };
  }
  if (a?.method === 'replay-candidate') {
    const basis = a.basis === 'confidence' ? '自动关联' : '沿用已核验轨迹';
    return {
      source: `雷视关联 · ${basis}`, position: '雷达定位', velocity: '雷达实测速度',
      detail: `采集时间差 ${Math.abs(a.timeDeltaMs)} ms。位置与速度来自雷达点迹。`,
    };
  }
  if (a?.method === 'offline-trajectory-fit') {
    return {
      source: '雷视关联', position: '雷达定位', velocity: '雷达实测速度',
      detail: `离线轨迹拟合，${a.samples} 帧参与验证，投影偏差中位数 ${a.medianResidualPx.toFixed(1)} px，90% 分位数 ${a.p90ResidualPx.toFixed(1)} px。位置与速度来自雷达点迹。`,
    };
  }
  if (a) {
    const held = a.status === 'held';
    return {source:held?'暂定关联 · 位置保持':'暂定轨迹关联',position:'关联雷达定位',
      velocity:held?`雷达观测 ${(a.radarAgeMs/1000).toFixed(1)}s 前`:'关联雷达速度',
      detail:`轨迹匹配用了 ${a.samples} 帧观测，位置偏差中位数 ${a.medianDistance.toFixed(1)}m。角度和速度来自该雷达记录。`};
  }
  if (target.camera && target.lastLinkedRadarId && !target.radar && !target.fusion) return {
    source: '视觉检测 · 暂无当前雷达定位', position: '暂无当前定位', velocity: '暂无当前速度',
    detail: '车辆编号沿用同一视觉轨迹最近一次配对的雷达编号，当前只有视觉检测。',
  };
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
