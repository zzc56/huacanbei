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
    expect(target.autoAssociation?.status).toBe('held');
    expect(target.autoAssociation?.method === 'trajectory-geometry-v1' && target.autoAssociation.score).toBeGreaterThan(.8);
    expect(measurementStatus(target).source).toContain('暂定关联');
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
  it('同一个框保留最高置信度的类别和原始下标，相邻车辆仍可显示', () => {
    const vision = fixture.vision!;
    const original = vision.detections[0]!;
    const higherConfidence = { ...original, x: String(Number(original.x) + 0.5), label: 'truck', score: '0.96' };
    const nearby = { ...original, x: String(Number(original.x) + 32) };
    const vehicleLinks = [0, 1, 2].map(detectionIndex => ({ ...vision.vehicleLinks[0]!, detectionIndex }));
    const frame = new RealDataAdapter().parse({ ...fixture, vision: { ...vision, detections: [original, higherConfidence, nearby], vehicleLinks } })!;
    const cameras = frame.targets.filter(target => target.camera);
    expect(cameras.map(target => target.camera?.detectionIndex)).toEqual([1, 2]);
    expect(cameras[0]).toMatchObject({ id: 'radar:39', camera: { class: 'truck', confidence: 0.96 } });
    expect(cameras[1].camera?.class).toBe('car');
    expect(frame.targets.filter(target => target.autoAssociation)).toHaveLength(1);
  });
  it('实时标定关联使用实时跟踪编号和已校正时间差', () => {
    const live = {
      ...fixture, type: 'live_frame',
      live: { association: { state: 'active', message: '实时雷视匹配' } },
      vision: {
        ...fixture.vision, detections: [{ ...fixture.vision.detections[0]!, track_id: 'V00001' }],
        captured_utc: new Date(Date.parse(fixture.vision.captured_utc) - 1600).toISOString(), alignmentDelayMs: 1600,
        vehicleLinks: [{ method: 'live-calibrated-position-v1', detectionIndex: 0, visualTrackId: 'V00001',
          radarId: 'radar:39', distanceM: 0.8, timeDeltaMs: 25 }],
      },
    };
    const frame = new RealDataAdapter().parse(live)!;
    const target = frame.targets.find(t => t.id === 'radar:39');
    expect(frame.targets).toHaveLength(1);
    expect(target?.camera?.trackId).toBe('V00001');
    expect(frame.cameraFrame?.alignmentDelayMs).toBe(1600);
    expect(target?.autoAssociation?.status).toBe('matched');
    expect(measurementStatus(target).source).toBe('实时雷视关联');
    const waiting = new RealDataAdapter().parse({
      ...live, live: { association: { state: 'waiting', message: '等待数据' } },
      vision: { ...live.vision, captured_utc: fixture.vision.captured_utc },
    })!;
    expect(waiting.targets.find(t => t.camera)?.radar).toBeUndefined();
  });
});
