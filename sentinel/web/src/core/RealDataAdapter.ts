import type { FrameData, ScalarField, Target, WorldBounds } from '../cockpit/types';
import { solveFusion, degrees } from '../cockpit/core/fusion';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
/** Empty CSV cells and JSON null are unknown, not zero. */
export const numeric = (v: unknown): number | undefined => {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'string' && !v.trim()) return undefined;
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const timestamp = (v: unknown) => typeof v === 'string' ? Date.parse(v) : numeric(v) ?? NaN;
const level = (v: number): 'low' | 'mid' | 'high' => v >= .75 ? 'high' : v >= .4 ? 'mid' : 'low';
export function polarToXY(range: number, azimuth: number) {
  const angle = azimuth * Math.PI / 180;
  return { x: range * Math.sin(angle), y: range * Math.cos(angle) };
}
function position(x: number, y: number, vx?: number, vy?: number): NonNullable<Target['fusion']> {
  if (vx !== undefined && vy !== undefined) return solveFusion(x, y, vx, vy);
  return { x, y, azimuth: degrees(Math.atan2(x, y)), vx: null, vy: null, speed: null, heading: null, radialVelocity: null, tangentialVelocity: null };
}
function axis(v: unknown, count: number): number[] | undefined {
  const a = array(v).map(numeric);
  if (a.length !== count || a.some((n, i) => n === undefined || i > 0 && n <= a[i - 1]!)) return;
  return a as number[];
}
export function parseRecordedField(raw: unknown): ScalarField | undefined {
  const r = obj(raw), w = numeric(r.grid_width), h = numeric(r.grid_height);
  if (r.field_available !== true || !w || !h || !Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > 262144) return;
  const xAxis = axis(r.x_axis, w), yAxis = axis(r.y_axis, h);
  const cells = array(r.display_field).flat(), mask = array(r.valid_field_mask).flat(), calibrated = array(r.calibrated_area_mask).flat();
  if (!xAxis || !yAxis || cells.length !== w * h || mask.length !== w * h) return;
  const values = new Float32Array(w * h).fill(NaN), valid = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i++) {
    const v = numeric(cells[i]);
    if (mask[i] === true && v !== undefined && v >= 0 && v <= 1) { values[i] = v; valid[i] = 1; }
  }
  return { width: w, height: h, xAxis, yAxis, values, valid,
    calibrated: calibrated.length === w * h ? Uint8Array.from(calibrated, v => v === true ? 1 : 0) : undefined,
    model: String(r.model_version ?? 'recorded'), scope: String(r.field_scope ?? 'unavailable'), timestamp: timestamp(r.observation_utc), revision: String(r.host_utc ?? r.observation_utc) };
}
function interval(axis: number[], point: number): number {
  if (point < axis[0] || point > axis[axis.length - 1]) return -1;
  let lo = 0, hi = axis.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (axis[mid] <= point) lo = mid; else hi = mid; }
  return lo;
}
export function sampleField(field: ScalarField | undefined, x: number, y: number): number | undefined {
  if (!field) return;
  const col = interval(field.xAxis, x), row = interval(field.yAxis, y);
  if (col < 0 || row < 0) return;
  const ids = [row * field.width + col, row * field.width + col + 1, (row + 1) * field.width + col, (row + 1) * field.width + col + 1];
  const u = (x - field.xAxis[col]) / (field.xAxis[col + 1] - field.xAxis[col]), v = (y - field.yAxis[row]) / (field.yAxis[row + 1] - field.yAxis[row]);
  const weights = [(1-u)*(1-v), u*(1-v), (1-u)*v, u*v];
  let result = 0;
  for (let i=0;i<4;i++) { if(weights[i]<1e-9)continue; if(!field.valid[ids[i]] || !Number.isFinite(field.values[ids[i]]))return; result += weights[i]*field.values[ids[i]]; }
  return result;
}
export function normalizeBox(v: unknown, width: number, height: number, pixels = true): [number, number, number, number] | undefined {
  const b = array(v).map(numeric);
  if (b.length !== 4 || b.some(x => x === undefined) || width <= 0 || height <= 0) return;
  const [x,y,w,h] = b as number[];
  if (w <= 0 || h <= 0) return;
  const left = Math.max(0, x / (pixels ? width : 1)), top = Math.max(0, y / (pixels ? height : 1));
  const right = Math.min(1,(x+w)/(pixels ? width : 1)), bottom = Math.min(1,(y+h)/(pixels ? height : 1));
  if (right <= left || bottom <= top) return;
  return [left,top,right-left,bottom-top];
}
function project(h: unknown, u: number, v: number) {
  const m = array(h).map(numeric);
  if (m.length !== 9 || m.some(n => n === undefined)) return;
  const a = m as number[], d = a[6]*u+a[7]*v+a[8];
  if (Math.abs(d)<1e-10)return;
  return { x:(a[0]*u+a[1]*v+a[2])/d, y:(a[3]*u+a[4]*v+a[5])/d };
}
function bounds(v: unknown): WorldBounds | undefined {
  const b = obj(v), a = [b.xMin,b.xMax,b.yMin,b.yMax].map(numeric);
  if(a.some(n=>n===undefined)||a[0]!>=a[1]!||a[2]!>=a[3]!)return;
  return {xMin:a[0]!,xMax:a[1]!,yMin:a[2]!,yMax:a[3]!};
}
export class RealDataAdapter {
  private history = new Map<string,{time:number;points:{x:number;y:number}[]}>();
  private last = -Infinity;
  private config: Obj = {};
  constructor(private baseUrl = 'http://127.0.0.1:3001/') {}
  setConfig(value: unknown) { this.config = obj(value); }
  private url(value: unknown): string | undefined {
    if(typeof value!=='string'||!value)return;
    try { const u=new URL(value,this.baseUrl); if(['http:','https:'].includes(u.protocol))return u.href; } catch { /* malformed external URL */ }
  }
  parse(value: unknown): FrameData | undefined {
    const raw=obj(value);
    // Status, selection and contour messages are not target frames.
    if(raw.type==='recorded_frame'||raw.type==='live_frame')return this.recorded(raw);
    const r=raw.type==='frame' ? obj(raw.frame) : raw;
    if(!Array.isArray(r.targets)||!Number.isFinite(numeric(r.timestamp)))return;
    return this.backend(r);
  }
  private trails(frame: FrameData) {
    if(frame.timestamp<this.last)this.history.clear(); this.last=frame.timestamp;
    for(const t of frame.targets) {
      if(!t.fusion)continue;
      const time=t.observationTimestamp ?? frame.timestamp, cached=this.history.get(t.id), prev=cached && time-cached.time<=1500 ? cached : undefined;
      const points=prev?.points ?? [];
      if(!prev || time>prev.time) { points.unshift({x:t.fusion.x,y:t.fusion.y}); if(points.length>40)points.pop(); this.history.set(t.id,{time,points}); }
      t.history=points.slice();
    }
    for(const [id,h] of this.history)if(frame.timestamp-h.time>30000)this.history.delete(id);
    return frame;
  }
  private recorded(raw: Obj): FrameData | undefined {
    const time=numeric(raw.timestamp); if(time===undefined)return;
    const incoming=obj(raw.snapshot), observation=timestamp(incoming.observation_utc), expires=timestamp(incoming.valid_until_utc);
    const fresh=raw.type!=='live_frame' || obj(obj(raw.live).radar).state==='streaming' &&
      Number.isFinite(observation) && observation<=time && time-observation<=1500 && expires>=time;
    const s=fresh?incoming:{}, context=obj(raw.context), vision=obj(raw.vision), targets: Target[]=[];
    const reference=timestamp(s.observation_utc);
    const field=parseRecordedField(s);
    const providedAssociation=obj(vision.association);
    const association=vision.association===undefined ? s : providedAssociation;
    const associationValid=association.calibration_valid===true && numeric(association.vision_sequence)===numeric(vision.sequence)
      && timestamp(association.observation_utc)<=time && timestamp(association.valid_until_utc)>=time;
    const pedestrianSource=associationValid ? association : s;
    for(const source of ['radar_objects','pedestrians']) for(const value of array((source==='pedestrians'?pedestrianSource:s)[source]).slice(0,256)) {
      // When supplied, the raw radar list is authoritative (including an empty list).
      // Aligned/predicted fusion positions must not replace measured range and angle.
      if(source==='radar_objects' && Array.isArray(raw.radar))continue;
      const r=obj(value), x=numeric(r.x), y=numeric(r.y);
      if(typeof r.id!=='string'||x===undefined||y===undefined)continue;
      const f=position(x,y,r.velocity_known===true?numeric(r.vx):undefined,r.velocity_known===true?numeric(r.vy):undefined);
      const t:Target={id:r.id,kind:typeof r.kind==='string'?r.kind:undefined,measurementSource:source==='radar_objects'?'radar':'recorded-vision',fusion:f,observationTimestamp:timestamp(r.observed_utc)};
      if(source==='radar_objects') t.radar={range:Math.hypot(x,y),azimuth:f.azimuth,radialVelocity:f.radialVelocity};
      const risk=sampleField(field,x,y); if(risk!==undefined){t.risk={value:risk,level:level(risk)};t.riskBasis='sampled-field';}
      targets.push(t);
    }
    // Always ingest independent radar detections, even with an unavailable risk field.
    for(const value of array(raw.radar).slice(0,256)) {
      const r=obj(value), range=numeric(r.range), azimuth=numeric(r.angle);
      const observed=timestamp(r.host_received_utc);
      if(range===undefined||azimuth===undefined||range<0||r.track_id===undefined||!Number.isFinite(observed)||observed>time||time-observed>1500)continue;
      const p=polarToXY(range,azimuth),f=position(p.x,p.y,numeric(r.vx_lateral),numeric(r.vy_longitudinal));
      const t:Target={id:'radar:'+String(r.track_id),measurementSource:'radar',fusion:f,radar:{range,azimuth,radialVelocity:f.radialVelocity,rcs:numeric(r.rcs),sequence:numeric(r.target_seq)},observationTimestamp:observed};
      const risk=sampleField(field,p.x,p.y);if(risk!==undefined){t.risk={value:risk,level:level(risk)};t.riskBasis='sampled-field';}
      const previous=targets.findIndex(target=>target.id===t.id);
      if(previous<0)targets.push(t);else if((targets[previous].observationTimestamp??-Infinity)<=observed)targets[previous]=t;
    }
    const width=numeric(vision.width) ?? 800,height=numeric(vision.height) ?? 448;
    const used=new Set<string>();
    const vehicleLinks=new Map<number,Obj>();
    for(const value of array(vision.vehicleLinks)){
      const link=obj(value),index=numeric(link.detectionIndex);
      if(index!==undefined&&Number.isInteger(index)&&index>=0&&!vehicleLinks.has(index))vehicleLinks.set(index,link);
    }
    array(vision.detections).slice(0,256).forEach((value,i)=>{
      const observed=timestamp(vision.captured_utc);
      if(raw.type==='live_frame'&&(!Number.isFinite(observed)||time-observed>1500||observed>time+500))return;
      const d=obj(value), bbox=normalizeBox([d.x,d.y,d.width,d.height],width,height), confidence=numeric(d.score);
      if(!bbox||confidence===undefined||confidence<0||confidence>1)return;
      const category=String(d.label ?? 'unknown').toLowerCase();
      const liveTrack=raw.type==='live_frame'&&typeof d.track_id==='string'&&/^V\d{1,12}$/.test(d.track_id)?d.track_id:undefined;
      const link=vehicleLinks.get(i)??{},camera={bbox,class:category,confidence,sequence:numeric(vision.sequence),detectionIndex:i,
        trackId:liveTrack??(typeof link.visualTrackId==='string'?link.visualTrackId:undefined)};
      const score=numeric(link.score),samples=numeric(link.samples),corr=numeric(link.correlation),distance=numeric(link.medianDistance),recordedAge=numeric(link.radarAgeMs);
      const radarTarget=targets.find(t=>t.id===link.radarId&&t.radar&&!used.has(t.id));
      const cameraTime=timestamp(vision.captured_utc),radarAge=time-(radarTarget?.observationTimestamp??-Infinity),delta=Math.abs((radarTarget?.observationTimestamp??-Infinity)-cameraTime);
      // This is an algorithmic identity hypothesis; kinematics stay on the original
      // radar observation and are never fabricated from bbox pixels.
      if(['car','truck','bus'].includes(category)&&radarTarget&&link.method==='trajectory-geometry-v1'&&['tentative','held'].includes(String(link.status))
        &&typeof link.visualTrackId==='string'&&score!==undefined&&score>=.7&&score<=1&&samples!==undefined&&Number.isInteger(samples)&&samples>=3
        &&corr!==undefined&&corr>=.65&&corr<=1&&distance!==undefined&&distance>=0&&distance<=8
        &&recordedAge!==undefined&&recordedAge>=0&&recordedAge<=1500&&radarAge>=0&&radarAge<=1500&&delta<=1500&&cameraTime<=time&&time-cameraTime<=1500){
        radarTarget.camera=camera;radarTarget.kind=category;
        radarTarget.autoAssociation={method:'trajectory-geometry-v1',status:link.status==='held'||Math.max(radarAge,delta,time-cameraTime)>500?'held':'tentative',
          radarId:radarTarget.id,visualTrackId:link.visualTrackId,score,samples,correlation:corr,medianDistance:distance,radarAgeMs:radarAge,alignmentDeltaMs:delta};
        used.add(radarTarget.id);return;
      }
      const p=project(obj(association.calibration).homography,(numeric(d.x)??0)+(numeric(d.width)??0)/2,(numeric(d.y)??0)+(numeric(d.height)??0));
      // Re-identify only the same recorded pedestrian and frame, using its saved calibration.
      // Pedestrian identity still uses the original saved same-frame mapping.
      const match=associationValid && category==='person' && p
        ? targets.find(t=>t.id.startsWith('ped:')&&!used.has(t.id)&&t.fusion&&Math.hypot(t.fusion.x-p.x,t.fusion.y-p.y)<0.05) : undefined;
      if(match){match.camera=camera;used.add(match.id);}
      else {
        const id=liveTrack?`vision:${liveTrack}`:`vision:${vision.sequence}:${i}`;
        if(!targets.some(t=>t.id===id))targets.push({id,kind:category,measurementSource:'vision-only',camera,observationTimestamp:timestamp(vision.captured_utc)});
      }
    });
    const replay=obj(raw.replay);
    const counts=obj(context.counts);
    const isLive=raw.type==='live_frame';
    const frame:FrameData={timestamp:time,source:isLive?'live':'recording',targets,riskField:field,
      bounds:bounds(context.bounds),radarRange:numeric(context.radarRange)??100,northCalibrated:context.northCalibrated===true,
      fps:numeric(context.dispatchHz)??10,message:typeof s.message==='string'?s.message:isLive?'实时融合尚未就绪':'当前时刻无有效融合快照，风险未知'};
    if(!isLive)frame.replay={positionMs:numeric(replay.positionMs)??0,durationMs:numeric(replay.durationMs)??0,ended:replay.ended===true};
    if(isLive){
      const live=obj(raw.live),radar=obj(live.radar),camera=obj(live.camera),fusion=obj(live.fusion);
      frame.live={startedAt:numeric(live.startedAt)??time,
        radar:{state:String(radar.state??'unknown'),endpoint:String(radar.endpoint??''),bytes:numeric(radar.bytes)??0,
          cycles:numeric(radar.cycles)??0,completeCycles:numeric(radar.completeCycles)??0,totalTargets:numeric(radar.totalTargets)??0,
          ageMs:numeric(radar.ageMs)??null,error:String(radar.error??'')},
        camera:{state:String(camera.state??'not-connected'),message:String(camera.message??'等待实时摄像头')},
        fusion:{state:String(fusion.state??'unavailable'),message:String(fusion.message??'实时融合尚未就绪')}};
    }
    if(['video','detections','radar','fusion'].every(key=>numeric(counts[key])!==undefined))frame.recordingCounts={video:Number(counts.video),detections:Number(counts.detections),radar:Number(counts.radar),fusion:Number(counts.fusion)};
    if(numeric(vision.sequence)!==undefined)frame.cameraFrame={sequence:Number(vision.sequence),width,height,timestamp:timestamp(vision.captured_utc),
      imageUrl:this.url(vision.imageUrl),videoUrl:this.url(context.videoUrl),videoTimeSeconds:numeric(vision.videoTimeSeconds)};
    if(field && Number.isFinite(reference))field.timestamp=reference;
    return this.trails(frame);
  }
  private backend(r: Obj): FrameData {
    const time=Number(r.timestamp),targets:Target[]=[], c=obj(this.config.camera), width=numeric(c.width)??1280,height=numeric(c.height)??720;
    for(const value of array(r.targets).slice(0,256)) {
      const t=obj(value); if(typeof t.id!=='string')continue;
      const f=obj(t.fusion),rd=obj(t.radar),cam=obj(t.camera),risk=obj(t.risk),out:Target={id:t.id,observationTimestamp:time};
      const range=numeric(rd.range),azimuth=numeric(rd.azimuth),vr=numeric(rd.radialVelocity);
      if(range!==undefined&&range>=0&&azimuth!==undefined)out.radar={range,azimuth,radialVelocity:vr??null};
      const p=range!==undefined&&azimuth!==undefined?polarToXY(range,azimuth):undefined;
      const x=numeric(f.x)??p?.x,y=numeric(f.y)??p?.y,speed=numeric(f.speed),heading=numeric(f.heading);
      const vx=numeric(f.vx)??(speed!==undefined&&heading!==undefined?speed*Math.sin(heading*Math.PI/180):undefined);
      const vy=numeric(f.vy)??(speed!==undefined&&heading!==undefined?speed*Math.cos(heading*Math.PI/180):undefined);
      if(x!==undefined&&y!==undefined){out.fusion=position(x,y,vx,vy);out.fusion.radialVelocity=numeric(f.radialVelocity)??vr??out.fusion.radialVelocity;out.fusion.tangentialVelocity=numeric(f.tangentialVelocity)??out.fusion.tangentialVelocity;}
      const bbox=normalizeBox(cam.bbox,width,height,t.bboxNormalized!==true),confidence=numeric(cam.confidence);
      if(bbox&&confidence!==undefined&&confidence>=0&&confidence<=1)out.camera={bbox,class:String(cam.class??'unknown').toLowerCase(),confidence};
      const rv=numeric(risk.value);if(rv!==undefined&&rv>=0&&rv<=1){out.risk={value:rv,level:level(rv)};out.riskBasis='backend-target';}
      if(out.radar||out.camera||out.fusion)targets.push(out);
    }
    let field:ScalarField|undefined;
    const rf=obj(r.riskField),g=obj(this.config.grid),w=numeric(rf.gridWidth),h=numeric(rf.gridHeight),resolution=numeric(rf.resolution);
    if(w&&h&&resolution&&w*h<=262144&&Number.isInteger(w)&&Number.isInteger(h)) {
      const xMin=numeric(rf.xMin)??numeric(g.xMin),yMin=numeric(rf.yMin)??numeric(g.yMin);
      if(xMin!==undefined&&yMin!==undefined){
        const values=new Float32Array(w*h).fill(NaN),valid=new Uint8Array(w*h);
        // Sparse protocol omits all low cells. They remain unknown, not zero.
        for(const zone of array(rf.highRiskZones)){const z=obj(zone),row=numeric(z.row),start=numeric(z.startColumn);if(row===undefined||start===undefined||!Number.isInteger(row)||!Number.isInteger(start)||row<0||row>=h)continue;array(z.values).forEach((item,i)=>{const v=numeric(item),col=start+i;if(v!==undefined&&v>=0&&v<=1&&col>=0&&col<w){values[row*w+col]=v;valid[row*w+col]=1;}});}
        field={width:w,height:h,xAxis:Array.from({length:w},(_,i)=>xMin+(i+.5)*resolution),yAxis:Array.from({length:h},(_,i)=>yMin+(i+.5)*resolution),values,valid,model:String(this.config.riskModel??'backend'),scope:'sparse-high-only',timestamp:time};
      }
    }
    return this.trails({timestamp:time,targets,source:'backend',riskField:field,fps:numeric(r.fps),northCalibrated:true,radarRange:numeric(this.config.radarMaxRange)??200,
      ...(field?{bounds:{xMin:field.xAxis[0],xMax:field.xAxis.at(-1)!,yMin:field.yAxis[0],yMax:field.yAxis.at(-1)!}}:{}),message:field?'后端风险场 · 未传输区域保持未知':'等待后端风险场'});
  }
}
