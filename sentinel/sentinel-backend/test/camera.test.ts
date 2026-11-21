import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {CameraFrameStore, registerCameraFrames} from '../src/live/camera.js';
import {registerVehicleRisk} from '../src/vehicle/service.js';
import type {VehicleResult} from '../src/vehicle/contracts.js';

test('vehicle input exposes fresh camera pixels and boxes even without a pose; replay stays isolated', async t=>{
  t.mock.timers.enable({apis:['Date'],now:5000});
  const app=Fastify(), camera=new CameraFrameStore();
  t.after(()=>app.close());
  registerCameraFrames(app,camera);
  registerVehicleRisk(app,camera);
  const jpeg=Buffer.from([255,216,12,34,255,217]);
  const detection={x:10,y:20,width:40,height:80,score:.91,label:'person',track_id:'V001'};
  assert.ok(camera.accept({sequence:8,capturedAt:5000,width:320,height:240,jpeg:jpeg.toString('base64'),detections:[detection]}));
  const frame=(await app.inject('/api/vehicle/frame')).json<VehicleResult>();
  assert.equal(frame.motion.action,'stop');
  assert.equal(frame.field,null);
  assert.deepEqual(frame.capture?.vision?.detections,[detection]);
  const url=frame.capture!.vision!.imageUrl;
  const image=await app.inject(url+'?at=5000');
  assert.equal(image.headers['content-type'],'image/jpeg');
  assert.deepEqual(image.rawPayload,jpeg);
  assert.equal((await app.inject(url+'?at=4999')).statusCode,404);
  assert.equal((await app.inject('/api/vehicle/demo/0')).json<VehicleResult>().capture,undefined);
  t.mock.timers.tick(1600);
  assert.equal((await app.inject('/api/vehicle/frame')).json<VehicleResult>().capture?.vision,null);
});

test('camera images and boxes stay sequence-bound; stale and invalid frames cannot become live',()=>{
  const store=new CameraFrameStore(),now=Date.now(),jpeg=Buffer.from([255,216,1,2,255,217]);
  const payload={sequence:1,capturedAt:now,width:800,height:448,detector:'local',jpeg:jpeg.toString('base64'),
    detections:[{x:10,y:20,width:30,height:40,label:'car',score:.9,track_id:'V00001'}]};
  assert.ok(store.accept(payload,now));
  assert.equal(store.snapshot(now).vision!.imageUrl,'/api/live/camera/1.jpg');
  assert.equal(store.snapshot(now).vision!.detections[0]!.track_id,'V00001');
  assert.deepEqual(store.image(1),jpeg);
  assert.equal(store.snapshot(now+1600).vision,null);
  assert.equal(store.snapshot(now+1600).status.state,'stale');
  assert.equal(store.accept({...payload,capturedAt:now-2000},now),false);
  assert.equal(store.accept({...payload,jpeg:'not-an-image'},now),false);
  for(let sequence=2;sequence<=40;sequence++)assert.ok(store.accept({...payload,sequence},now));
  assert.equal(store.image(1),undefined);
  store.clear('disconnected','disconnected');
  assert.equal(store.snapshot(now).vision,null);assert.equal(store.image(40),undefined);
});
test('new camera frames publish immediately; reordered frames cannot rewind the live image',()=>{
  const store=new CameraFrameStore(), now=Date.now(), jpeg=Buffer.from([255,216,1,2,255,217]).toString('base64');
  const payload={sequence:2,capturedAt:now,width:800,height:448,jpeg,detections:[],
    timing:{inferenceMs:40,encodeMs:2,processingMs:44,decodeThreads:1,inferenceThreads:2,invalid:NaN}};
  const published:number[]=[];
  const unsubscribe=store.onFrame(()=>published.push(store.snapshot(now).vision!.sequence));
  assert.equal(store.accept(payload,now),true);
  assert.deepEqual(published,[2]);
  assert.deepEqual(store.snapshot(now).status.timing,{inferenceMs:40,encodeMs:2,processingMs:44,decodeThreads:1,inferenceThreads:2});
  assert.equal(store.accept({...payload,sequence:1},now),false);
  assert.equal(store.accept({...payload,sequence:3,capturedAt:now-1},now),false);
  assert.equal(store.snapshot(now).vision!.sequence,2);
  assert.deepEqual(published,[2]);
  unsubscribe();
  assert.equal(store.accept({...payload,sequence:3},now),true);
  assert.deepEqual(published,[2]);
  store.clear('connecting','restarted');
  assert.equal(store.accept({...payload,sequence:1},now),true,'a restarted capture process can reset its sequence');
});
