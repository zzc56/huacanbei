import type { VehicleResult } from '../../../../sentinel-backend/src/vehicle/contracts';
import { normalizeBox, position, sampleField } from '../../core/RealDataAdapter';
import type { Frame, ScalarField, Target } from '../types';

/** Adapt one vehicle evaluation for the existing cockpit inspectors and scenes. */
export function vehicleScene(result: VehicleResult | null, origin: string, retainedCapture?: VehicleResult['capture']): Frame {
  const timestamp = result?.evaluatedAtMs ?? 0, grid = result?.field;
  const capture = result?.capture?.vision ? result.capture : retainedCapture ?? result?.capture, image = capture?.vision;
  const field: ScalarField | undefined = grid ? {
    width:grid.width, height:grid.height, values:Float32Array.from(grid.values), valid:new Uint8Array(grid.values.length).fill(1),
    xAxis:Array.from({length:grid.width}, (_,i)=>grid.xMin+(i+.5)*grid.resolution),
    yAxis:Array.from({length:grid.height}, (_,i)=>grid.yMin+(i+.5)*grid.resolution),
    timestamp, model:'SENTINEL', scope:'vehicle',
  } : undefined;
  const cam = result?.observations.camera, lidar = result?.observations.lidar;
  const ground = cam?.observations ?? [], scan = lidar?.observations ?? [];
  const targets: Target[] = [];
  const byLidar = new Map<number,Target>(), byCamera = new Map<number,Target>();
  function groundId(i:number) {
    return ground[i].trackId ? 'C-' + ground[i].trackId : 'C' + (i+1) + '@' + cam!.capturedAtMs;
  }
  function lidarId(i:number) {
    return scan[i].trackId ? 'L-' + scan[i].trackId : 'L' + (i+1) + '@' + lidar!.capturedAtMs;
  }
  for (const o of result?.obstacles ?? []) {
    const ci=o.cameraIndex, li=o.lidarIndex;
    const id=ci!==undefined && ground[ci].trackId ? groundId(ci) : li!==undefined ? lidarId(li) : groundId(ci!);
    const value=sampleField(field,o.xM,o.yM);
    const t:Target={id, vehicleSource:o.source, fusion:position(o.xM,o.yM),
      observationTimestamp:Math.max(ci!==undefined?cam!.capturedAtMs:0, li!==undefined?lidar!.capturedAtMs:0)};
    if(value!==undefined){t.risk={value,level:value>=.75?'high':value>=.4?'mid':'low'};t.riskBasis='sampled-field';}
    if(ci!==undefined)byCamera.set(ci,t);
    if(li!==undefined)byLidar.set(li,t);
    targets.push(t);
  }
  ground.forEach((point,i)=>{
    let t=byCamera.get(i);
    if(!t){t={id:groundId(i),vehicleSource:'camera',observationTimestamp:cam!.capturedAtMs};targets.push(t);byCamera.set(i,t);}
    t.groundObservation=point;
  });
  scan.forEach((p,i)=>{
    let t=byLidar.get(i);
    if(!t){t={id:lidarId(i),vehicleSource:'lidar',observationTimestamp:lidar!.capturedAtMs};targets.push(t);}
    t.radar={range:p.rangeM,azimuth:p.bearingDeg,radialVelocity:null};
  });
  const capturedAt=image ? Date.parse(image.captured_utc) : 0;
  if(image) {
    const synchronized=cam?.sequence===image.sequence && cam.capturedAtMs===capturedAt;
    const groundTracks=new Map(synchronized ? ground.flatMap((p,i)=>p.trackId ? [[p.trackId,byCamera.get(i)!] as const] : []) : []);
    image.detections.forEach((d,i)=>{
      const bbox=normalizeBox([d.x,d.y,d.width,d.height],image.width,image.height);
      if(!bbox)return;
      const t=groundTracks.get(d.track_id) ?? {id:'V-'+d.track_id,observationTimestamp:capturedAt};
      t.camera={bbox,class:d.label,confidence:d.score,sequence:image.sequence,detectionIndex:i,trackId:d.track_id};
      t.kind=d.label;
      if(!groundTracks.has(d.track_id))targets.push(t);
    });
  }
  const maxRange=Math.max(1,...scan.map(p=>p.rangeM));
  return {
    source:'vehicle', timestamp, targets, northCalibrated:false, radarRange:2**Math.ceil(Math.log2(maxRange)), riskField:field,
    bounds:grid ? {xMin:grid.xMin,xMax:grid.xMin+grid.width*grid.resolution,yMin:grid.yMin,yMax:grid.yMin+grid.height*grid.resolution}:undefined,
    vehicle:{cameraMessage:capture?.status.message??'等待固定摄像头接入'},
    cameraFrame:image ? {sequence:image.sequence,width:image.width,height:image.height,timestamp:capturedAt,
      imageUrl:new URL(image.imageUrl+'?at='+capturedAt,origin).href}:undefined,
  };
}
