import { expect,it } from 'vitest';
import { RealDataAdapter } from './RealDataAdapter';
it('实时硬件帧保留实测运动量与状态，不混入录像、风险或回放进度',()=>{
  const now=Date.now(),adapter=new RealDataAdapter();
  const envelope={type:'live_frame',timestamp:now,snapshot:null,vision:null,
    radar:[{track_id:37,range:14.201408380861432,angle:.8069294551024407,vx_lateral:0,vy_longitudinal:12.75,host_received_utc:new Date(now-50).toISOString()}],
    context:{source:'live',radarRange:100,northCalibrated:false},
    live:{startedAt:now-5000,radar:{state:'streaming',cycles:42,bytes:600,ageMs:50},camera:{state:'not-connected'},fusion:{state:'unavailable'}}};
  const frame=adapter.parse(envelope)!;
  expect(frame.source).toBe('live');expect(frame.replay).toBeUndefined();
  expect(frame.cameraFrame).toBeUndefined();expect(frame.riskField).toBeUndefined();
  expect(frame.targets[0].fusion!.y).toBeCloseTo(14.2);
  expect(frame.targets[0].fusion!.vy).toBe(12.75);
  expect(frame.live?.radar.cycles).toBe(42);
  const expired=adapter.parse({...envelope,timestamp:now+2000})!;
  expect(expired.targets).toEqual([]);
});
it('实时摄像头保持视觉轨迹 ID，检测框与原始图像尺寸匹配且不伪造运动量',()=>{
  const now=Date.now(),adapter=new RealDataAdapter('http://127.0.0.1:3001');
  const envelope={type:'live_frame',timestamp:now,radar:[],snapshot:null,
    vision:{sequence:1,captured_utc:new Date(now).toISOString(),width:800,height:448,imageUrl:'/api/live/camera/1.jpg',
      detections:[{x:80,y:44.8,width:160,height:89.6,label:'car',score:.91,track_id:'V00001'}]}};
  const frame=adapter.parse(envelope)!;
  expect(frame.targets[0].id).toBe('vision:V00001');
  expect(frame.targets[0].camera?.bbox[0]).toBeCloseTo(.1);
  expect(frame.targets[0].fusion).toBeUndefined();expect(frame.targets[0].radar).toBeUndefined();
  expect(frame.cameraFrame?.imageUrl).toBe('http://127.0.0.1:3001/api/live/camera/1.jpg');
  expect(adapter.parse({...envelope,vision:{...envelope.vision,sequence:2}})!.targets[0].id).toBe(frame.targets[0].id);
  expect(adapter.parse({...envelope,timestamp:now+2000})!.targets).toEqual([]);
});
it('实时雷达风险场显示低场值；视觉目标不继承风险，过期或断线时清除场值',()=>{
  const now=Date.now(),adapter=new RealDataAdapter();
  const snapshot={field_available:true,field_scope:'radar_only',calibration_valid:false,
    grid_width:2,grid_height:2,x_axis:[-1,1],y_axis:[19,21],
    display_field:[.1,.2,.3,.4],valid_field_mask:[true,true,true,true],
    observation_utc:new Date(now).toISOString(),valid_until_utc:new Date(now+1500).toISOString(),
    model_version:'live-radar-distance-ttc-v1',message:'实时雷达相对风险估计'};
  const envelope={type:'live_frame',timestamp:now,snapshot,
    radar:[{track_id:7,range:20,angle:0,vx_lateral:0,vy_longitudinal:-8,host_received_utc:new Date(now).toISOString()}],
    vision:{sequence:1,captured_utc:new Date(now).toISOString(),width:800,height:448,
      detections:[{x:80,y:40,width:160,height:80,label:'car',score:.9,track_id:'V00001'}]},
    live:{radar:{state:'streaming'},fusion:{state:'radar_only'}}};
  const frame=adapter.parse(envelope)!;
  expect(frame.riskField?.scope).toBe('radar_only');
  expect(frame.targets.find(t=>t.radar)?.risk?.value).toBeCloseTo(.25);
  expect(frame.targets.find(t=>t.camera)?.risk).toBeUndefined();
  expect(frame.targets.find(t=>t.camera)?.fusion).toBeUndefined();
  for(const value of [
    {...envelope,timestamp:now+1501},
    {...envelope,timestamp:now-1},
    {...envelope,live:{radar:{state:'disconnected'}}},
    {...envelope,snapshot:{...snapshot,valid_until_utc:new Date(now-1).toISOString()}},
  ]){
    const expired=adapter.parse(value)!;
    expect(expired.riskField).toBeUndefined();
    expect(expired.targets.every(t=>t.risk===undefined)).toBe(true);
  }
  const empty=adapter.parse({...envelope,radar:[],snapshot:{...snapshot,display_field:[0,0,0,0]}})!;
  expect(Array.from(empty.riskField!.values)).toEqual([0,0,0,0]);
});
