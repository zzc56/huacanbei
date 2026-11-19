import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';
import { Tcr300Decoder } from '../src/live/tcr300.js';
import { buildApp } from '../src/app.js';

const radarRecording=resolve('../数据保存/20261019_124204_141_74b30263');

test('TCR300 handles byte fragmentation, noise, and matches all 483 saved vendor observations', {
  skip: !existsSync(radarRecording) && 'Requires the original radar recording',
}, () => {
  const bytes=readFileSync(resolve(radarRecording,'raw.bin'));
  const csv=readFileSync(resolve(radarRecording,'targets.csv'),'utf8').trim().split(/\r?\n/);
  const header=csv.shift()!.split(',');
  const expected=csv.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[header[i]!,v])));
  const decoder=new Tcr300Decoder();
  const output=decoder.push(Buffer.concat([Buffer.from([0,1,2]),bytes])).filter(m=>m.type==='target');
  assert.equal(output.length,483);
  output.forEach((m,i)=>{
    for(const key of ['track_id','x_lateral','y_longitudinal','vx_lateral','vy_longitudinal','range','rcs'] as const)
      assert.ok(Math.abs(m.target[key]-Number(expected[i]![key]))<1e-8,key);
    const angle=(Number(expected[i]!['angle'])+360)%360;
    assert.ok(Math.abs(m.target.angle-angle)<1e-8);
  });
  const fragmented=new Tcr300Decoder();
  const messages=Array.from(bytes.subarray(0,900)).flatMap(byte=>fragmented.push(Buffer.from([byte])));
  assert.deepEqual(messages,new Tcr300Decoder().push(bytes.subarray(0,900)));
});

test('Live service is driven by TCP: measured values, zero-target cycles and disconnect clearing', async t=>{
  let peer:net.Socket|undefined;
  const tcp=net.createServer(socket=>{peer=socket;});
  await new Promise<void>(resolve=>tcp.listen(0,'127.0.0.1',resolve));
  const address=tcp.address() as net.AddressInfo;
  const app=buildApp('live',{host:'127.0.0.1',port:address.port,localAddress:'127.0.0.1'});
  t.after(async()=>{await app.close();peer?.destroy();await new Promise<void>(resolve=>tcp.close(()=>resolve()));});
  await app.ready();
  for(let i=0;i<40&&!peer;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(peer);
  peer.write(Buffer.from('aaaa0a060120ec00000000005555aaaa0b0625505c008ce008125555','hex'));
  await new Promise(resolve=>setTimeout(resolve,40));
  let frame=(await app.inject('/api/live/frame')).json();
  assert.equal(frame.type,'live_frame');assert.equal(frame.context.source,'live');
  assert.equal(frame.radar.length,1);assert.equal(frame.radar[0].track_id,37);
  assert.equal(frame.radar[0].vy_longitudinal,12.75);
  assert.equal(frame.snapshot.field_available,true);assert.equal(frame.vision,null);
  assert.equal(frame.snapshot.field_scope,'radar_only');
  assert.equal(frame.snapshot.calibration_valid,false);
  assert.ok(frame.snapshot.display_field.some((v:number)=>v>0));
  assert.equal(frame.live.fusion.state,'radar_only');
  assert.equal(frame.live.radar.completeCycles,1);
  assert.equal(frame.replay,undefined);
  peer.write(Buffer.from('aaaa0a060020ed00000000005555','hex'));
  await new Promise(resolve=>setTimeout(resolve,30));
  frame=(await app.inject('/api/live/frame')).json();
  assert.equal(frame.radar.length,0);assert.equal(frame.live.radar.cycles,2);
  assert.ok(frame.snapshot.display_field.every((v:number)=>v===0));
  peer.destroy();
  await new Promise(resolve=>setTimeout(resolve,30));
  frame=(await app.inject('/api/live/frame')).json();
  assert.equal(frame.radar.length,0);assert.equal(frame.live.radar.state,'disconnected');
  assert.equal(frame.snapshot,null);assert.equal(frame.live.fusion.state,'unavailable');
});
