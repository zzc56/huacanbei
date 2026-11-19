/** Causal replay association. Scores measure consistency, never identity probability.
 * No fitted transform or clock offset is silently substituted for the recorded calibration.
 */
type Row = Record<string,string>;
type Box = [number,number,number,number];
interface Calibration { homography:number[]; image_width:number; image_height:number; points:{image_x:number;image_y:number}[] }
interface Snapshot { observation_utc:string; calibration_valid?:unknown; calibration?:unknown }
interface Detection {time:number;sequence:number;index:number;box:Box;confidence:number}
interface Track {id:number;history:Detection[];evidence:Map<string,Evidence[]>;lock?:Candidate}
interface Radar {id:string;time:number;sequence:number;x:number;y:number;vx:number;vy:number;range:number}
interface Evidence {time:number;radarSequence:number;height:number;range:number;distance:number}
interface Candidate {radarId:string;score:number;samples:number;correlation:number;medianDistance:number;spanMs:number;lastEvidenceTime:number}
export interface VehicleLink {
  detectionIndex:number;visualTrackId:string;radarId?:string;
  status:'unmatched'|'tentative'|'held';reason:string;
  score?:number;samples?:number;correlation?:number;medianDistance?:number;
  radarAgeMs?:number;method:'trajectory-geometry-v1';
}
export const associationPolicy={alignmentMs:500,holdMs:1500,trackGapMs:1500,minSamples:3,minSpanMs:400,
  minRangeChange:2,minHeightLogChange:.04,minCorrelation:.65,maxMedianDistance:8,
  maxSampleDistance:15,minScore:.7,ambiguityMargin:.12,clockOffsetMs:0} as const;
const finite=(v:unknown):number|undefined=>{
  if(v===null||v===undefined||v===''||typeof v==='boolean')return;
  const n=Number(v);return Number.isFinite(n)?n:undefined;
};
const median=(a:number[])=>{const b=[...a].sort((a,b)=>a-b),i=Math.floor(b.length/2);return b.length%2?b[i]!:(b[i-1]!+b[i]!)/2;};
const center=(b:Box)=>[b[0]+b[2]/2,b[1]+b[3]] as const;
function iou(a:Box,b:Box){const area=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));return area/(a[2]*a[3]+b[2]*b[3]-area);}
function slope(t:number[],v:number[]){const mt=t.reduce((a,b)=>a+b,0)/t.length,mv=v.reduce((a,b)=>a+b,0)/v.length;let a=0,b=0;t.forEach((x,i)=>{a+=(x-mt)*(v[i]!-mv);b+=(x-mt)**2;});return b>1e-10?a/b:0;}
function correlation(x:number[],y:number[]){const mx=x.reduce((a,b)=>a+b,0)/x.length,my=y.reduce((a,b)=>a+b,0)/y.length;let a=0,b=0,c=0;x.forEach((v,i)=>{a+=(v-mx)*(y[i]!-my);b+=(v-mx)**2;c+=(y[i]!-my)**2;});return b*c>1e-10?a/Math.sqrt(b*c):0;}
function ground(box:Box,calibration:unknown):{x:number;y:number}|undefined{
  if(!calibration||typeof calibration!=='object')return;
  const c=calibration as Calibration,h=c.homography,points=c.points;
  if(!Array.isArray(h)||h.length!==9||!h.every(Number.isFinite)||!Array.isArray(points)||points.length<3)return;
  const [u,v]=center(box);let sign=0;
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!;
    if(![a.image_x,a.image_y,b.image_x,b.image_y].every(Number.isFinite))return;
    const cross=(b.image_x-a.image_x)*(v-a.image_y)-(b.image_y-a.image_y)*(u-a.image_x);
    if(Math.abs(cross)<1e-7)continue;
    if(sign && Math.sign(cross)!==sign)return;sign=Math.sign(cross);
  }
  const d=h[6]!*u+h[7]!*v+h[8]!;if(Math.abs(d)<1e-8)return;
  const x=(h[0]!*u+h[1]!*v+h[2]!)/d,y=(h[3]!*u+h[4]!*v+h[5]!)/d;
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:undefined;
}
function candidate(radarId:string,items:Evidence[]):Candidate|undefined{
  const p=associationPolicy;
  if(items.length<p.minSamples||new Set(items.map(x=>x.radarSequence)).size<p.minSamples)return;
  const span=items.at(-1)!.time-items[0]!.time,range=items.map(x=>x.range),height=items.map(x=>x.height);
  if(span<p.minSpanMs||Math.max(...range)-Math.min(...range)<p.minRangeChange||Math.log(Math.max(...height)/Math.min(...height))<p.minHeightLogChange)return;
  const corr=correlation(height,range.map(r=>-r)),distance=median(items.map(x=>x.distance));
  if(corr<p.minCorrelation||distance>p.maxMedianDistance)return;
  const score=.5*corr+.2*Math.max(0,1-distance/12)+.15*Math.min(1,items.length/5)+.15*Math.min(1,span/1500);
  if(score<p.minScore)return;
  return {radarId,score,samples:items.length,correlation:corr,medianDistance:distance,spanMs:span,lastEvidenceTime:items.at(-1)!.time};
}
export class VehicleAssociator {
  readonly frames=new Map<number,VehicleLink[]>();
  readonly report:{policy:typeof associationPolicy;method:string;verifiedIdentity:boolean;matches:({visualTrackId:string;firstSequence:number}&Candidate)[]};
  constructor(frames:Row[],detections:Map<number,Row[]>,radarRows:Row[],snapshots:Snapshot[]){
    const p=associationPolicy,tracks:Track[]=[],latest=new Map<string,Radar>();let radarIndex=0,snapshotIndex=-1;
    const records=radarRows.flatMap(r=>{
      const range=finite(r['range']),azimuth=finite(r['angle']),vx=finite(r['vx_lateral']),vy=finite(r['vy_longitudinal']),time=Date.parse(r['host_received_utc']!);
      if(range===undefined||range<0||azimuth===undefined||vx===undefined||vy===undefined||!Number.isFinite(time))return [];
      return [{id:'radar:'+r['track_id'],time,sequence:Number(r['target_seq']),x:range*Math.sin(azimuth*Math.PI/180),y:range*Math.cos(azimuth*Math.PI/180),vx,vy,range}];
    }).sort((a,b)=>a.time-b.time);
    this.report={policy:p,method:'causal track continuity + recorded homography + size/range correlation',verifiedIdentity:false,matches:[]};
    for(const f of frames){
      const time=Date.parse(f['captured_utc']!),sequence=Number(f['sequence']);if(!Number.isFinite(time))continue;
      while(radarIndex<records.length && records[radarIndex]!.time<=time){const r=records[radarIndex++]!;latest.set(r.id,r);}
      while(snapshotIndex+1<snapshots.length && Date.parse(snapshots[snapshotIndex+1]!.observation_utc)<=time)snapshotIndex++;
      const s=snapshots[snapshotIndex];
      const raw:Detection[]=[];
      (detections.get(sequence)??[]).forEach((d,index)=>{
        if(!['car','truck','bus'].includes(d['label']??''))return;
        const box=[d['x'],d['y'],d['width'],d['height']].map(finite),confidence=finite(d['score']);
        if(box.some(v=>v===undefined)||box[2]!<=0||box[3]!<=0||confidence===undefined||confidence<.5||confidence>1)return;
        raw.push({time,sequence,index,box:box as Box,confidence});
      });
      // Suppress duplicate class predictions only for association; every raw box still renders.
      const ds:Detection[]=[];
      for(const d of raw.sort((a,b)=>b.confidence-a.confidence))if(!ds.some(o=>iou(o.box,d.box)>.7))ds.push(d);
      const options:{cost:number;d:Detection;t:Track}[]=[];
      for(const d of ds)for(const t of tracks){
        const last=t.history.at(-1)!,dt=(time-last.time)/1000;if(dt<=0||dt*1000>p.trackGapMs)continue;
        const prediction=[...last.box] as Box,history=t.history.slice(-6),times=history.map(h=>(h.time-last.time)/1000);
        prediction[0]+=Math.max(-220,Math.min(220,slope(times,history.map(h=>center(h.box)[0]))))*dt;
        prediction[1]+=Math.max(-60,Math.min(60,slope(times,history.map(h=>center(h.box)[1]))))*dt;
        const a=center(prediction),b=center(d.box),distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
        const gate=Math.max(22,Math.min(90,d.box[2]*.65+dt*30)),size=Math.abs(Math.log(d.box[3]/prediction[3]));
        if(distance<gate&&size<.8)options.push({cost:distance/gate+size*.4-iou(prediction,d.box)*.4,d,t});
      }
      const usedD=new Set<Detection>(),usedT=new Set<Track>(),assignments:{d:Detection;t:Track}[]=[];
      for(const a of options.sort((a,b)=>a.cost-b.cost))if(!usedD.has(a.d)&&!usedT.has(a.t)){a.t.history.push(a.d);usedD.add(a.d);usedT.add(a.t);assignments.push(a);}
      for(const d of ds)if(!usedD.has(d)){const t:Track={id:tracks.length+1,history:[d],evidence:new Map()};tracks.push(t);assignments.push({d,t});}
      const choices:{d:Detection;t:Track;c:Candidate}[]=[];
      for(const {d,t} of assignments){
        const point=s?.calibration_valid===true ? ground(d.box,s.calibration) : undefined;
        if(point)for(const r of latest.values()){
          const age=time-r.time;if(age<0||age>p.alignmentMs)continue;
          const dt=age/1000,distance=Math.hypot(point.x-r.x-r.vx*dt,point.y-r.y-r.vy*dt);
          if(distance>p.maxSampleDistance)continue;
          const evidence=t.evidence.get(r.id)??[];
          evidence.push({time,radarSequence:r.sequence,height:d.box[3],range:r.range,distance});
          t.evidence.set(r.id,evidence.slice(-20));
        }
        const candidates=[...t.evidence].flatMap(([id,items])=>{
          if(time-items.at(-1)!.time>p.holdMs)return [];
          const c=candidate(id,items);return c?[c]:[];
        }).sort((a,b)=>b.score-a.score);
        if(t.lock){const updated=candidates.find(c=>c.radarId===t.lock!.radarId);if(updated)t.lock=updated;}
        if(t.lock){if(time-t.lock.lastEvidenceTime<=p.holdMs && time-(latest.get(t.lock.radarId)?.time??-Infinity)<=p.holdMs)choices.push({d,t,c:t.lock});}
        else if(candidates[0] && (!candidates[1]||candidates[0].score-candidates[1].score>=p.ambiguityMargin))choices.push({d,t,c:candidates[0]});
      }
      const links:VehicleLink[]=[],usedRadar=new Set<string>();
      for(const {d,t,c} of choices.sort((a,b)=>b.c.score-a.c.score)){
        const rivals=choices.filter(o=>o.t!==t&&o.c.radarId===c.radarId);
        if(usedRadar.has(c.radarId)||rivals.some(o=>c.score-o.c.score<p.ambiguityMargin))continue;
        const r=latest.get(c.radarId)!;if(!r||time-r.time>p.holdMs)continue;
        if(!t.lock){t.lock=c;this.report.matches.push({visualTrackId:'vehicle:'+t.id,firstSequence:sequence,...c});}
        usedRadar.add(c.radarId);
        links.push({detectionIndex:d.index,visualTrackId:'vehicle:'+t.id,radarId:c.radarId,
          status:Math.max(time-r.time,time-c.lastEvidenceTime)>p.alignmentMs?'held':'tentative',reason:'automatic-unverified',
          score:c.score,samples:c.samples,correlation:c.correlation,medianDistance:c.medianDistance,radarAgeMs:time-r.time,method:'trajectory-geometry-v1'});
      }
      for(const {d,t} of assignments)if(!links.some(l=>l.detectionIndex===d.index))links.push({detectionIndex:d.index,visualTrackId:'vehicle:'+t.id,status:'unmatched',reason:t.lock?'radar-expired-or-ambiguous':'insufficient-or-ambiguous-evidence',method:'trajectory-geometry-v1'});
      this.frames.set(sequence,links);
    }
  }
}
