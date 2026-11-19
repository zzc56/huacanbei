import test from 'node:test';
import assert from 'node:assert/strict';
import { VehicleAssociator } from '../src/recording/vehicle-association.js';
import { Recording } from '../src/recording/replay.js';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const start=Date.parse('2026-01-01T00:00:00Z'),utc=(ms:number)=>new Date(start+ms).toISOString();
function sample(opposite=false,ambiguous=false){
  const times=[0,500,1000,1500,2600,3301];
  const frames=times.map((t,i)=>({sequence:String(i+1),captured_utc:utc(t)}));
  const detections=new Map(frames.map((f,i)=>{
    const range=30-Math.min(i,3)*3,height=opposite?range/3:300/range;
    return [i+1,[{sequence:f.sequence,x:'90',y:String(range-height),width:'20',height:String(height),score:'.9',label:'car'}]];
  }));
  const radar=times.slice(0,4).flatMap((t,i)=>[1,...(ambiguous?[2]:[])].map(id=>({target_seq:String(i+1),track_id:String(id),host_received_utc:utc(t),range:String(30-i*3),angle:'0',vx_lateral:'0',vy_longitudinal:'-6'})));
  const snapshots=[{observation_utc:utc(0),calibration_valid:true,calibration:{homography:[1,0,-100,0,1,0,0,0,1],image_width:200,image_height:200,points:[{image_x:0,image_y:0},{image_x:200,image_y:0},{image_x:200,image_y:200},{image_x:0,image_y:200}]}}];
  return {frames,detections,radar,snapshots};
}
test('consistent motion needs multiple independent observations; holds expire without inventing samples',()=>{
  const d=sample(),a=new VehicleAssociator(d.frames,d.detections,d.radar,d.snapshots);
  assert.equal(a.frames.get(1)![0]!.status,'unmatched');assert.equal(a.frames.get(2)![0]!.status,'unmatched');
  assert.equal(a.frames.get(3)![0]!.status,'tentative');assert.equal(a.frames.get(3)![0]!.radarId,'radar:1');
  assert.equal(a.frames.get(5)![0]!.status,'held');assert.equal(a.frames.get(5)![0]!.radarAgeMs,1100);
  assert.equal(a.frames.get(6)![0]!.status,'unmatched');assert.equal(a.report.verifiedIdentity,false);
});
test('ambiguous equal radar candidates and contradictory size/range motion remain unassociated',()=>{
  for(const d of [sample(false,true),sample(true,false)]){
    const a=new VehicleAssociator(d.frames,d.detections,d.radar,d.snapshots);
    assert.equal(a.report.matches.length,0);assert.ok([...a.frames.values()].flat().every(l=>l.status==='unmatched'));
  }
});
test('offline replay indexing is causal: future observations do not alter earlier assignments',()=>{
  const d=sample(),full=new VehicleAssociator(d.frames,d.detections,d.radar,d.snapshots);
  for(let n=1;n<=d.frames.length;n++){
    const until=Date.parse(d.frames[n-1]!.captured_utc);
    const prefix=new VehicleAssociator(d.frames.slice(0,n),d.detections,d.radar.filter(r=>Date.parse(r.host_received_utc)<=until),d.snapshots);
    assert.deepEqual(prefix.frames.get(n),full.frames.get(n));
  }
});
test('invalid calibration and unsupported image region cannot initiate association',()=>{
  const d=sample();d.snapshots[0]!.calibration_valid=false;
  assert.equal(new VehicleAssociator(d.frames,d.detections,d.radar,d.snapshots).report.matches.length,0);
  d.snapshots[0]!.calibration_valid=true;d.snapshots[0]!.calibration.points.forEach(p=>{p.image_x+=500;});
  assert.equal(new VehicleAssociator(d.frames,d.detections,d.radar,d.snapshots).report.matches.length,0);
});
const recordingRoot=fileURLToPath(new URL('../../../数据保存/',import.meta.url));

test('recorded vehicle crossing keeps separate visual tracks and only proposes the three supported radar tracks', {
  skip: !existsSync(recordingRoot) && 'Requires the original Sentinel recording',
}, ()=>{
  const r=new Recording(recordingRoot),a=r.vehicleAssociator;
  assert.deepEqual(a.report.matches.map(m=>m.radarId),['radar:39','radar:41','radar:42']);
  assert.equal(a.frames.get(2501)![0]!.status,'held');assert.equal(a.frames.get(2502)![0]!.status,'unmatched');
  const crossing=a.frames.get(2561)!;
  assert.equal(new Set(crossing.map(l=>l.visualTrackId)).size,2);
  assert.equal(a.frames.get(2568)!.find(l=>l.status==='tentative')?.visualTrackId,'vehicle:4');
  for(const links of a.frames.values()){
    const matches=links.filter(l=>l.radarId);
    assert.equal(new Set(matches.map(l=>l.radarId)).size,matches.length);
    for(const link of matches){assert.ok(link.samples!>=3);assert.ok(link.radarAgeMs!<=1500);assert.ok(link.score!>=.7);}
  }
});
