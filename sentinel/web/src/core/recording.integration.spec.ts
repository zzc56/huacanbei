import { expect,it } from 'vitest';
import { RealDataAdapter } from './RealDataAdapter';
// Optional whole-recording integration suite against the running local backend.
it.runIf(process.env.REAL_DATA_INTEGRATION==='1')('整段实测逐时刻解析，无非有限坐标、失配框、无效风险或重复 ID',async()=>{
  const origin=process.env.REAL_DATA_ORIGIN??'http://127.0.0.1:3001';
  const manifest=await(await fetch(origin+'/api/replay/manifest')).json() as {durationMs:number;counts:{video:number;detections:number}};
  const adapter=new RealDataAdapter(origin);let frames=0,fields=0,empty=0,boxes=0,radar=0;
  const seenBoxes=new Set<string>(),seenCameraFrames=new Set<number>();
  const associatedRadars=new Set<string>(),associatedFrames=new Set<string>();
  for(let ms=0;ms<=manifest.durationMs;ms+=100){
    const raw=await(await fetch(origin+'/api/replay/frame?timeMs='+ms)).json();
    const f=adapter.parse(raw)!;expect(f).toBeDefined();expect(f.source).toBe('recording');
    if(f.cameraFrame)seenCameraFrames.add(f.cameraFrame.sequence);
    expect(f.targets.filter(t=>t.camera)).toHaveLength(raw.vision?.detections.length??0);
    expect(f.targets.filter(t=>t.radar)).toHaveLength(raw.radar.length);
    for(const r of raw.radar){const target=f.targets.find(t=>t.id==='radar:'+r.track_id)!;expect(target.radar?.range).toBe(Number(r.range));expect(target.radar?.azimuth).toBe(Number(r.angle));}
    expect(new Set(f.targets.map(t=>t.id)).size).toBe(f.targets.length);
    if(f.riskField)fields++;if(!f.targets.length)empty++;
    for(const t of f.targets){
      if(t.fusion){expect(Number.isFinite(t.fusion.x)&&Number.isFinite(t.fusion.y)).toBe(true);for(const key of ['vx','vy','radialVelocity','tangentialVelocity'] as const)expect(t.fusion[key]===null||Number.isFinite(t.fusion[key])).toBe(true);}
      if(t.radar){radar++;expect(Number.isFinite(t.radar.range)&&Number.isFinite(t.radar.azimuth)).toBe(true);}
      if(t.camera){boxes++;expect(t.camera.bbox.every(v=>Number.isFinite(v)&&v>=0&&v<=1)).toBe(true);expect(f.cameraFrame).toBeDefined();seenBoxes.add(t.camera.sequence+':'+t.camera.detectionIndex);}
      if(t.risk)expect(t.risk.value>=0&&t.risk.value<=1).toBe(true);
      if(t.autoAssociation){
        expect(t.radar).toBeDefined();expect(t.camera).toBeDefined();expect(t.autoAssociation.radarId).toBe(t.id);
        expect(t.autoAssociation.radarAgeMs).toBeLessThanOrEqual(1500);
        const link=raw.vision.vehicleLinks.find((l:{detectionIndex:number})=>l.detectionIndex===t.camera!.detectionIndex);
        expect(link.radarId).toBe(t.id);
        associatedRadars.add(t.id);associatedFrames.add(t.camera!.sequence+':'+t.id);
      }
    }
    frames++;
  }
  expect(frames).toBeGreaterThan(2300);expect(fields).toBeGreaterThan(500);expect(empty).toBeGreaterThan(0);expect(boxes).toBeGreaterThan(0);expect(radar).toBeGreaterThan(0);
  expect(seenCameraFrames.size).toBe(manifest.counts.video);
  expect(seenBoxes.size).toBe(manifest.counts.detections);
  expect([...associatedRadars].sort()).toEqual(['radar:39','radar:41','radar:42']);expect(associatedFrames.size).toBeGreaterThan(20);
  console.info(JSON.stringify({frames,fields,empty,boxes,radar,uniqueCameraFrames:seenCameraFrames.size,uniqueDetectionRows:seenBoxes.size,autoAssociatedRadars:[...associatedRadars],autoAssociatedFrames:associatedFrames.size}));
},60000);
