import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CameraFrameStore} from '../src/live/camera.js';

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
