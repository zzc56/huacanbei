import { describe,it,expect } from 'vitest';
import fixture from './fixtures/vehicle-frame.json';
import { RealDataAdapter } from './RealDataAdapter';
import { measurementStatus } from './measurementStatus';

describe('真实车辆自动关联候选',()=>{
  it('第2501帧车辆框绑定radar:39，运动量仍来自原始雷达，不填充缺失风险场',()=>{
    const f=new RealDataAdapter().parse(fixture)!,target=f.targets.find(t=>t.id==='radar:39')!;
    expect(f.targets).toHaveLength(1);expect(target.camera?.class).toBe('car');
    expect(target.camera?.confidence).toBeCloseTo(.8914438486099243);
    expect(target.fusion?.radialVelocity).toBeCloseTo(-5.75);expect(target.fusion?.tangentialVelocity).toBeCloseTo(-1.5);
    expect(target.fusion?.azimuth).toBeCloseTo(0);expect(target.radar?.range).toBeCloseTo(20);
    expect(target.autoAssociation?.status).toBe('held');expect(target.autoAssociation?.score).toBeGreaterThan(.8);
    expect(measurementStatus(target).source).toContain('待确认');
    expect(f.riskField).toBeUndefined();expect(target.risk).toBeUndefined();
  });
  it('没有当前雷达、证据不足、错误ID或非法评分时不得把运动量填给车辆',()=>{
    const original=fixture.vision!.vehicleLinks[0]!;
    for(const patch of [{radarId:'radar:unknown'},{score:.1},{samples:2},{radarAgeMs:1501},{status:'unmatched'}]){
      const f=new RealDataAdapter().parse({...fixture,vision:{...fixture.vision,vehicleLinks:[{...original,...patch}]}})!;
      const camera=f.targets.find(t=>t.camera)!;expect(camera.fusion).toBeUndefined();expect(camera.autoAssociation).toBeUndefined();
    }
    const f=new RealDataAdapter().parse({...fixture,radar:[]})!;
    expect(f.targets.find(t=>t.camera)?.fusion).toBeUndefined();
  });
  it('同一雷达不可绑定两个框，重复类别检测仍保留在画面中',()=>{
    const link=fixture.vision!.vehicleLinks[0]!,d=fixture.vision!.detections[0]!;
    const f=new RealDataAdapter().parse({...fixture,vision:{...fixture.vision,detections:[d,d],vehicleLinks:[link,{...link,detectionIndex:1}]}})!;
    expect(f.targets.filter(t=>t.camera)).toHaveLength(2);expect(f.targets.filter(t=>t.autoAssociation)).toHaveLength(1);
    expect(new Set(f.targets.map(t=>t.id)).size).toBe(f.targets.length);
  });
});
