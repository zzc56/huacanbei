import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { Recording,parseCsv } from '../src/recording/replay.js';
import { fileURLToPath } from 'node:url';

const recordingRoot=fileURLToPath(new URL('../../../数据保存/',import.meta.url));
const recordingTest={skip: !existsSync(recordingRoot) && 'Requires the original Sentinel recording'};

test('CSV parser preserves blanks, quoted commas and escaped quotes',()=>{
  assert.deepEqual(parseCsv('id,x,note\r\n1,,"a,b"\r\n2,0,"a""b"\r\n'),[{id:'1',x:'',note:'a,b'},{id:'2',x:'0',note:'a"b'}]);
});
test('entire measured timeline: exact video sequence, no future frames and valid risk dimensions',recordingTest,()=>{
  const recording=new Recording(recordingRoot);
  let fields=0,frames=0,independentVision=0;
  const seenSequences=new Set<number>();
  for(let time=0;time<=recording.end-recording.start;time+=100){
    const p=recording.packet(time);frames++;
    if(p.vision){
      assert.ok(Date.parse(p.vision['captured_utc']!)<=p.timestamp);
      const latest=recording.frames.findLast(f=>Date.parse(f['captured_utc']!)<=p.timestamp)!;
      assert.equal(p.vision.sequence,latest['sequence']);
      assert.ok(p.vision.detections.every(d=>d['sequence']===p.vision!.sequence));
      seenSequences.add(Number(p.vision.sequence));
      if(p.snapshot && Number(p.vision.sequence)!==p.snapshot.vision_sequence)independentVision++;
    }
    for(const row of p.radar){
      assert.ok(Date.parse(row['host_received_utc']!)<=p.timestamp);
      const latest=recording.radar.findLast(r=>r['track_id']===row['track_id'] && Date.parse(r['host_received_utc']!)<=p.timestamp)!;
      assert.equal(row['target_seq'],latest['target_seq']);
    }
    if(p.snapshot?.field_available){fields++;const w=Number(p.snapshot['grid_width']),h=Number(p.snapshot['grid_height']);assert.equal((p.snapshot['display_field'] as unknown[]).length,w*h);}
  }
  assert.ok(frames>2300);assert.ok(fields>500);
  assert.equal(recording.snapshots.length,451);assert.equal(recording.frames.length,787);
  assert.equal(seenSequences.size,787);
  assert.equal([...seenSequences].reduce((n,s)=>n+(recording.detections.get(s)?.length??0),0),258);
  assert.ok(independentVision>0,'camera must advance even while fusion references another frame');
});

test('all 483 raw radar observations are reachable at their receive timestamps regardless of fusion',recordingTest,()=>{
  const recording=new Recording(recordingRoot);
  for(const row of recording.radar){
    const packet=recording.packet(Date.parse(row['host_received_utc']!)-recording.start);
    assert.ok(packet.radar.some(r=>r['target_seq']===row['target_seq']),`missing radar row ${row['target_seq']}`);
  }
  assert.equal(recording.radar.length,483);
});

test('camera identity lookup is independent of the current risk snapshot and never uses a different frame',recordingTest,()=>{
  const recording=new Recording(recordingRoot);
  const camera=recording.bySequence.get(2561)!;
  const time=Math.ceil((Date.parse(camera['captured_utc']!)-recording.start)/100)*100;
  const packet=recording.packet(time);
  assert.equal(packet.snapshot?.vision_sequence,2559);
  assert.equal(packet.vision?.association?.vision_sequence,2561);
  assert.ok((packet.vision?.association?.pedestrians as {id:string}[]).some(p=>p.id==='ped:36'));
  for(let ms=0;ms<=recording.end-recording.start;ms+=100){
    const p=recording.packet(ms),a=p.vision?.association;
    if(a){assert.equal(a.vision_sequence,Number(p.vision!.sequence));assert.ok(Date.parse(a.observation_utc)<=p.timestamp);assert.ok(Date.parse(a.valid_until_utc)>=p.timestamp);}
  }
});
test('recording WebSocket runs at 10 Hz, pause/seek/end are isolated per connection; media supports ranges',{...recordingTest,timeout:15000},async t=>{
  const app=buildApp('recording');await app.listen({host:'127.0.0.1',port:0});
  const addr=app.server.address();assert.ok(addr&&typeof addr!=='string');
  const ws=new WebSocket(`ws://127.0.0.1:${addr.port}/stream`);
  t.after(async()=>{ws.terminate();await app.close();});
  const messages:Record<string,unknown>[]=[],arrivals:number[]=[];
  ws.on('message',v=>{const m=JSON.parse(v.toString()) as Record<string,unknown>;messages.push(m);if(m['type']==='recorded_frame')arrivals.push(performance.now());});
  const until=async(p:()=>boolean)=>{const start=Date.now();while(!p()){if(Date.now()-start>4000)throw Error('Timeout');await delay(10);}};
  await once(ws,'open');await until(()=>arrivals.length>=12);
  const hz=11000/(arrivals[11]!-arrivals[0]!);assert.ok(hz>8&&hz<12);t.diagnostic(`recorded stream ${hz.toFixed(2)} Hz`);
  ws.send(JSON.stringify({action:'pause'}));await until(()=>messages.some(m=>m['type']==='system_state'&&m['state']==='paused'));
  const count=arrivals.length;await delay(250);assert.equal(arrivals.length,count);
  ws.send(JSON.stringify({action:'seek',positionMs:8500}));await until(()=>arrivals.length>count);
  const frame=messages.filter(m=>m['type']==='recorded_frame').at(-1)!;assert.equal((frame['replay'] as {positionMs:number}).positionMs,8500);
  assert.equal((frame['snapshot'] as {vision_sequence:number}).vision_sequence,1988);
  ws.send(JSON.stringify({action:'play'}));await until(()=>arrivals.length>count+2);
  assert.equal((await app.inject('/api/health')).json<{source:string}>().source,'recording');
  assert.equal((await app.inject('/api/replay/frame?timeMs=NaN')).statusCode,400);
  const media=await app.inject({url:'/media/recording.webm',headers:{range:'bytes=0-127'}});assert.equal(media.statusCode,206);assert.equal(media.rawPayload.length,128);
  assert.equal((await app.inject('/media/frames/1988.jpg')).statusCode,200);
  assert.equal((await app.inject({url:'/api/config',headers:{origin:'https://untrusted.example'}})).statusCode,403);
});
