import { describe, it, expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import fixture from './fixtures/recorded-frame.json';
import { RealDataAdapter, numeric, normalizeBox, polarToXY, parseRecordedField, sampleField } from './RealDataAdapter';
import { useSceneStore } from '../cockpit/stores/scene';

describe('实测数据适配与缺失值',()=>{
  it('CSV 空值、null 和非法数字不是 0，极坐标按 +Y 顺时针',()=>{
    for(const v of ['',null,undefined,'NaN',Infinity,false])expect(numeric(v)).toBeUndefined();
    expect(numeric('0')).toBe(0);
    expect(polarToXY(12,90).x).toBeCloseTo(12);expect(polarToXY(12,180).y).toBeCloseTo(-12);
  });
  it('回放真实 8.7 秒记录：原始极坐标、分速度、像素框及共享 ID 一致',()=>{
    const frame=new RealDataAdapter().parse(fixture)!;
    expect(frame.source).toBe('recording');expect(frame.targets).toHaveLength(4);
    const radar=frame.targets.find(t=>t.id==='radar:37')!;
    expect(radar.fusion!.x).toBeCloseTo(.2);expect(radar.fusion!.y).toBeCloseTo(16.2);
    expect(radar.radar!.range).toBe(Number(fixture.radar[0].range));
    expect(radar.radar!.sequence).toBe(Number(fixture.radar[0].target_seq));
    expect(radar.fusion!.speed).toBeCloseTo(12.75);
    expect(radar.fusion!.radialVelocity!**2+radar.fusion!.tangentialVelocity!**2).toBeCloseTo(12.75**2);
    const ped=frame.targets.find(t=>t.id==='ped:5')!;
    expect(ped.camera?.class).toBe('person');expect(ped.camera?.confidence).toBeCloseTo(.5021116733551025);
    const detection=fixture.vision.detections.find(d=>Number(d.score)===ped.camera!.confidence)!;
    expect(ped.camera!.bbox[0]).toBeCloseTo(Number(detection.x)/800);
    expect(ped.camera!.bbox[1]).toBeCloseTo(Number(detection.y)/448);
    expect(radar.camera).toBeUndefined(); // no fabricated car association
    expect(frame.cameraFrame?.sequence).toBe(fixture.snapshot.vision_sequence);
    expect(frame.northCalibrated).toBe(false);
  });
  it('速度未知保留 null；无地面标定的视觉框不伪造位置或风险',()=>{
    const f=new RealDataAdapter().parse(fixture)!;
    expect(f.targets.find(t=>t.id==='ped:9')!.fusion!.vx).toBeNull();
    expect(f.targets.find(t=>t.id==='ped:9')!.fusion!.radialVelocity).toBeNull();
    const vision=f.targets.find(t=>t.id.startsWith('vision:'))!;
    expect(vision.camera).toBeDefined();expect(vision.fusion).toBeUndefined();expect(vision.risk).toBeUndefined();
  });
  it('逐格读取保存的风险矩阵，mask 外保持未知，不重新计算模型',()=>{
    const f=parseRecordedField(fixture.snapshot)!;
    expect(f.width).toBe(37);expect(f.height).toBe(48);
    fixture.snapshot.display_field.forEach((v,i)=>{
      if(fixture.snapshot.valid_field_mask[i]&&v!==null)expect(f.values[i]).toBeCloseTo(v,6);
      else {expect(f.valid[i]).toBe(0);expect(Number.isNaN(f.values[i])).toBe(true);}
    });
    expect(sampleField(f,-999,0)).toBeUndefined();
    const t=new RealDataAdapter().parse(fixture)!.targets[0];
    expect(t.risk!.value).toBeCloseTo(sampleField(f,t.fusion!.x,t.fusion!.y)!);
    expect(parseRecordedField({...fixture.snapshot,field_available:false})).toBeUndefined();
  });
  it('空帧清空全部数据，状态消息不冒充帧，异常框独立丢弃',()=>{
    const adapter=new RealDataAdapter();adapter.parse(fixture);
    const empty=adapter.parse({...fixture,snapshot:null,radar:[],vision:null})!;
    expect(empty.targets).toEqual([]);expect(empty.riskField).toBeUndefined();expect(empty.cameraFrame).toBeUndefined();
    expect(adapter.parse({type:'system_state',state:'paused'})).toBeUndefined();
    expect(normalizeBox([0,0,-1,20],800,448)).toBeUndefined();
    expect(normalizeBox([null,0,20,20],800,448)).toBeUndefined();
    expect(normalizeBox([-10,10,30,20],100,100)).toEqual([0,.1,.2,.19999999999999998]);
  });
  it('稀疏后端网格保留未知单元，同时恢复旧协议 vx/vy 和像素框',()=>{
    const adapter=new RealDataAdapter();adapter.setConfig({grid:{xMin:-2,yMin:0},camera:{width:1280,height:720}});
    const frame=adapter.parse({timestamp:100,targets:[{id:'T1',fusion:{x:0,y:10,speed:5,heading:90},camera:{bbox:[128,72,256,144],class:'Car',confidence:.8}}],riskField:{gridWidth:4,gridHeight:3,resolution:1,highRiskZones:[{row:1,startColumn:2,values:[.7]}]}})!;
    expect(frame.targets[0].fusion!.vx).toBeCloseTo(5);expect(frame.targets[0].camera!.bbox).toEqual([.1,.1,.19999999999999998,.19999999999999998]);
    expect(frame.riskField!.valid[6]).toBe(1);expect(frame.riskField!.values[6]).toBeCloseTo(.7);expect(Number.isNaN(frame.riskField!.values[0])).toBe(true);
  });
  it('缺失风险不稀释平均值；空场显示未知',()=>{
    setActivePinia(createPinia());const store=useSceneStore();
    expect(store.averageRisk).toBeNull();store.frame=new RealDataAdapter().parse(fixture)!;
    expect(store.knownRiskTargets).toHaveLength(3);
    expect(store.averageRisk).toBeCloseTo(store.knownRiskTargets.reduce((s,t)=>s+t.risk!.value,0)/3);
    store.select('ped:9');expect(store.selected?.fusion?.radialVelocity).toBeNull();
  });
  it('回放跳回时清空未来航迹，重复发送同一观测不增长航迹',()=>{
    const a=new RealDataAdapter();a.parse(fixture);const repeat=a.parse(fixture)!;
    expect(repeat.targets.find(t=>t.radar)?.history).toHaveLength(1);
    const changed=structuredClone(fixture);changed.timestamp+=1000;changed.radar[0].host_received_utc='2026-10-19T04:42:09.117Z';changed.radar[0].range='20';
    expect(a.parse(changed)!.targets.find(t=>t.radar)?.history).toHaveLength(2);
    expect(a.parse(fixture)!.targets.find(t=>t.radar)?.history).toHaveLength(1);
  });
  it('有融合状态但场无效时，仍保留独立雷达和全部视觉检测',()=>{
    const frame=new RealDataAdapter().parse({...fixture,snapshot:{status:'no_valid_observations',field_available:false}})!;
    expect(frame.targets.filter(t=>t.radar)).toHaveLength(1);
    expect(frame.targets.filter(t=>t.camera)).toHaveLength(fixture.vision.detections.length);
    expect(frame.riskField).toBeUndefined();
    expect(frame.targets.every(t=>!t.risk)).toBe(true);
    expect(frame.targets.find(t=>t.radar)?.fusion?.y).toBeCloseTo(16.2);
  });
  it('融合引用旧帧时，新帧检测仍完整显示，不能套用旧行人身份',()=>{
    const frame=new RealDataAdapter().parse({...fixture,snapshot:{...fixture.snapshot,vision_sequence:1988}})!;
    const cameras=frame.targets.filter(t=>t.camera);
    expect(cameras).toHaveLength(fixture.vision.detections.length);
    cameras.forEach((target,i)=>{
      expect(target.id).toBe(`vision:1989:${i}`);
      expect(target.camera?.sequence).toBe(1989);
      expect(target.camera?.confidence).toBe(Number(fixture.vision.detections[i].score));
      expect(target.fusion).toBeUndefined();
    });
  });
  it('空雷达列表清空旧融合雷达，重复 ID 取最新记录，未来观测不提前显示',()=>{
    const adapter=new RealDataAdapter();
    expect(adapter.parse({...fixture,radar:[]})!.targets.some(t=>t.radar)).toBe(false);
    const row=fixture.radar[0],future={...row,track_id:'future',host_received_utc:'2026-10-19T05:00:00Z'};
    const old={...row,range:'1',host_received_utc:'2026-10-19T04:42:08.293Z'};
    const frame=adapter.parse({...fixture,radar:[row,old,future]})!;
    expect(frame.targets.filter(t=>t.radar)).toHaveLength(1);
    expect(frame.targets.find(t=>t.radar)?.radar?.range).toBe(Number(row.range));
  });
  it('风险场引用另一帧时，独立的同帧行人关联恢复位置与速度',()=>{
    const frame=new RealDataAdapter().parse({...fixture,
      snapshot:{...fixture.snapshot,vision_sequence:1988,pedestrians:[]},
      vision:{...fixture.vision,association:fixture.snapshot}})!;
    const target=frame.targets.find(t=>t.id==='ped:5')!;
    expect(target.camera?.sequence).toBe(1989);
    expect(target.fusion?.vx).toBeCloseTo(-.9950676976712929);
    expect(target.fusion?.azimuth).toBeCloseTo(357.6092,3);
    expect(frame.targets.filter(t=>t.camera)).toHaveLength(3);
  });
  it('关联必须同帧、未过期且不来自未来；错误关联不带入运动量',()=>{
    for(const patch of [{vision_sequence:1},{observation_utc:'2030-01-01T00:00:00Z'},{valid_until_utc:'2020-01-01T00:00:00Z'}]){
      const frame=new RealDataAdapter().parse({...fixture,vision:{...fixture.vision,association:{...fixture.snapshot,...patch}}})!;
      const cameras=frame.targets.filter(t=>t.camera);
      expect(cameras).toHaveLength(3);expect(cameras.every(t=>!t.fusion)).toBe(true);
    }
  });
});
