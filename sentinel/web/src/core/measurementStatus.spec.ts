import { describe,it,expect } from 'vitest';
import { measurementStatus } from './measurementStatus';
import { RealDataAdapter } from './RealDataAdapter';
import fixture from './fixtures/recorded-frame.json';

describe('缺失运动量的来源说明',()=>{
  const frame=new RealDataAdapter().parse(fixture)!;
  it('视觉框未关联不能展示其他雷达的速度或方位角',()=>{
    const target=frame.targets.find(t=>t.measurementSource==='vision-only')!;
    expect(measurementStatus(target).source).toBe('视觉检测 · 未关联');
    expect(measurementStatus(target).velocity).toBe('未关联，暂无速度');
    expect(target.fusion).toBeUndefined();
  });
  it('行人位置有效但 velocity_known=false 时说明原记录缺失速度',()=>{
    expect(measurementStatus(frame.targets.find(t=>t.id==='ped:9')).velocity).toBe('原记录未提供速度');
    expect(measurementStatus(frame.targets.find(t=>t.id==='ped:5')).velocity).toBe('视觉轨迹估计');
    expect(measurementStatus(frame.targets.find(t=>t.id==='radar:37')).velocity).toBe('雷达速度分解');
  });
});
