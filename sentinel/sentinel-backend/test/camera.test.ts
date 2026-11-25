import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,rmdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {CameraFrameStore, LiveCamera, registerCameraDetectionSettings, registerCameraFrames} from '../src/live/camera.js';
import {registerVehicleRisk,saveCameraCalibration} from '../src/vehicle/service.js';
import type {StockLidarSample,VehicleResult} from '../src/vehicle/contracts.js';

test('selecting a supported class filters live and buffered camera observations', async t=>{
  t.mock.method(LiveCamera.prototype as unknown as {start:(url:string)=>void},'start',()=>{});
  const app=Fastify(), camera=new LiveCamera();
  t.after(()=>app.close());
  camera['updateDetectionCatalog'](['person','sports ball','bottle']);
  const origin='http://127.0.0.1:4173';
  registerCameraDetectionSettings(app,camera,new Set([origin]));
  const now=Date.now();
  assert.ok(camera.accept({
    sequence:1,capturedAt:now,width:320,height:240,detector:'local',jpeg:Buffer.from([255,216,255,217]).toString('base64'),
    detections:['person','sports ball','bottle','sports ball'].map((label,i)=>({x:15+i*10,y:25,width:20,height:25,label,score:.9,track_id:'V00'+i,
      ...(i===3 ? {previewOnly:true} : {})})),
  },now));
  const url='/api/vehicle/camera-classes';
  const save=(selected:string[])=>app.inject({method:'POST',url,headers:{origin},payload:{selected}});
  assert.deepEqual((await app.inject(url)).json(),{available:['person','sports ball','bottle'],selected:['person'],preset:'traffic'});
  const usePreset=(preset:string)=>app.inject({method:'POST',url,headers:{origin},payload:{preset}});
  assert.equal((await usePreset('unknown')).statusCode,400);
  assert.equal((await usePreset('ball')).json().preset,'ball');
  const capture=camera.snapshot(now);
  assert.deepEqual(capture.vision?.detections.map(box=>box.label),['person']);
  assert.deepEqual(camera.displaySnapshot(capture,now).vision?.detections.map(box=>box.label),['sports ball','sports ball']);
  assert.deepEqual((await usePreset('sports')).json().selected,['person','sports ball']);
  assert.deepEqual(camera.displaySnapshot(capture,now).vision?.detections.map(box=>box.label),['person','sports ball','sports ball']);
  assert.deepEqual(camera.snapshot(now).vision?.detections.map(box=>box.label),['person']);
  assert.equal((await usePreset('traffic')).json().preset,'traffic');
  assert.deepEqual(camera.displaySnapshot(capture,now).vision?.detections.map(box=>box.label),['person']);
  assert.equal((await save(['unknown'])).statusCode,400);
  assert.equal((await save(['sports ball','bottle'])).statusCode,200);
  assert.deepEqual(camera.snapshot(now).vision?.detections.map(box=>box.label),['sports ball','bottle']);
  assert.deepEqual(camera.snapshotsSince(now,now)[0]?.vision?.detections.map(box=>box.label),['sports ball','bottle']);
  camera['updateDetectionCatalog'](['person','sports ball','bottle']);
  assert.deepEqual(camera.detectionSettings().selected,['sports ball','bottle']);
});

test('the camera stream pushes the matching capture as soon as a new frame arrives', async ()=>{
  const app = Fastify(), camera = new CameraFrameStore();
  registerVehicleRisk(app, camera, '');
  const origin = await app.listen({host:'127.0.0.1',port:0});
  const controller = new AbortController();
  const timeout = AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]);
  try {
    const response = await fetch(origin+'/api/vehicle/camera-stream', {signal:timeout});
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    async function nextFrame(): Promise<VehicleResult> {
      while (!pending.includes('\n\n')) {
        const {value,done} = await reader.read();
        assert.equal(done,false);
        pending += decoder.decode(value,{stream:true});
      }
      const boundary = pending.indexOf('\n\n');
      const event = pending.slice(0,boundary);
      pending = pending.slice(boundary+2);
      return JSON.parse(event.slice('data: '.length));
    }
    assert.equal((await nextFrame()).capture?.vision,null);
    assert.ok(camera.accept({
      sequence:1,capturedAt:Date.now(),width:320,height:240,detector:'local',
      jpeg:Buffer.from([255,216,255,217]).toString('base64'),
      detections:[{x:120,y:48,width:80,height:72,label:'person',score:.95,track_id:'V001'}],
    }));
    const frame = await nextFrame();
    assert.equal(frame.capture?.vision?.sequence,1);
    assert.equal(frame.capture?.vision?.imageUrl,'/api/live/camera/1.jpg');
    assert.equal(frame.capture?.vision?.detections[0]?.track_id,'V001');
  } finally {
    controller.abort();
    await app.close();
  }
});

test('saving live calibration persists four ground points and updates projections', async t=>{
  t.mock.timers.enable({apis:['Date'],now:5000});
  const directory=mkdtempSync(join(tmpdir(),'sentinel-calibration-'));
  const devices=join(directory,'devices.json');
  const original={radar:{port:7000},camera:{enabled:true,deviceIndex:0,groundCalibration:null}};
  writeFileSync(devices,JSON.stringify(original));
  t.after(()=>{rmSync(devices,{force:true}); rmdirSync(directory);});
  const app=Fastify(), camera=new CameraFrameStore();
  t.after(()=>app.close());
  const origin='http://127.0.0.1:4173';
  registerVehicleRisk(app,camera,'',{
    editor:{
      origins:new Set([origin]),
      persist:settings=>saveCameraCalibration(devices,settings),
    },
  });
  const settings={
    width:320,height:240,
    points:[
      {u:.1,v:.1,x:0,y:0}, {u:.9,v:.1,x:.5,y:0},
      {u:.9,v:.9,x:.5,y:.5}, {u:.1,v:.9,x:0,y:.5},
    ],
  };
  const save=(payload:object, headers:Record<string,string>={origin}, remoteAddress='127.0.0.1') =>
    app.inject({method:'POST',url:'/api/vehicle/calibration',payload,headers,remoteAddress});
  assert.equal((await save(settings,{})).statusCode,403);
  assert.equal((await save(settings,{origin},'192.0.2.1')).statusCode,403);
  assert.equal((await save(settings)).statusCode,409);
  assert.ok(camera.accept({
    sequence:1,capturedAt:5000,width:320,height:240,detector:'local',jpeg:Buffer.from([255,216,255,217]).toString('base64'),
    detections:[{x:120,y:48,width:80,height:72,label:'person',score:.95,track_id:'V001'}],
  }));
  assert.equal((await save({...settings,width:800})).statusCode,409);
  assert.equal((await save({...settings,points:settings.points.slice(0,3)})).statusCode,400);
  assert.deepEqual(JSON.parse(readFileSync(devices,'utf8')),original);
  assert.deepEqual((await save(settings)).json(),{saved:true});
  assert.deepEqual(JSON.parse(readFileSync(devices,'utf8')),{
    ...original,camera:{...original.camera,groundCalibration:{...settings,cameraOffsetMs:0,alignmentWindowMs:100}},
  });
  const frame=(await app.inject('/api/vehicle/frame')).json<VehicleResult>();
  const point=frame.observations.camera?.observations[0];
  assert.equal(point?.trackId,'V001');
  assert.ok(Math.abs(point.xM-.25)<1e-6 && Math.abs(point.yM-.25)<1e-6);
  assert.equal(frame.observations.camera?.includedInFusion,false);
});

test('stationary vehicle fusion joins projected camera and serial radar in the confirmed pose', async t=>{
  t.mock.timers.enable({apis:['Date'],now:5000});
  const app=Fastify(), camera=new CameraFrameStore();
  t.after(()=>app.close());
  const stationaryId='924f3542-8161-46de-8715-e65f6fb945b8';
  let id: string|null = stationaryId;
  const sample:StockLidarSample={sequence:1,capturedTickMs:100,receivedAtMs:4940,nearest:{rangeM:1,bearingDeg:0}};
  let scans=[sample];
  registerVehicleRisk(app,camera,JSON.stringify({
    width:320,height:240,cameraOffsetMs:0,alignmentWindowMs:100,
    points:[
      {u:0,v:0,x:0,y:0},{u:1,v:0,x:2,y:0},
      {u:1,v:1,x:2,y:2},{u:0,v:1,x:0,y:2},
    ],
  }), {readStationaryRadar:requested=>requested===id ? {sinceMs:4000,scans} : null});
  const url='/api/vehicle/stationary-fusion?xM=0.2&yM=0.1&headingDeg=90&stationaryId='+stationaryId;
  const frame=async()=> (await app.inject(url)).json<VehicleResult>();
  assert.equal((await frame()).stationaryFusion,'waiting_for_camera');
  const cameraInput={
    width:320,height:240,detector:'local',jpeg:Buffer.from([255,216,255,217]).toString('base64'),
    detections:[{x:172,y:4,width:40,height:8,label:'person',score:.95,track_id:'V001'}],
  };
  assert.ok(camera.accept({...cameraInput,sequence:1,capturedAt:4780}));
  assert.ok(camera.accept({...cameraInput,sequence:2,capturedAt:5000}));
  const fused=await frame();
  assert.equal(fused.stationaryFusion,'aligned');
  assert.ok(fused.field);
  assert.deepEqual(fused.obstacles.map(point=>point.source),['both']);
  assert.equal(fused.observations.camera?.includedInFusion,true);
  assert.equal(fused.observations.camera?.sequence,2);
  assert.equal(fused.observations.lidar?.capturedAtMs,4940);

  const unmatched={...sample,receivedAtMs:4895};
  scans=[unmatched,{...sample,receivedAtMs:4850}];
  const stillAligned=await frame();
  assert.ok(stillAligned.field);
  assert.equal(stillAligned.capture?.vision?.sequence,2);
  assert.equal(stillAligned.observations.camera?.sequence,1);
  assert.equal(stillAligned.observations.lidar?.capturedAtMs,4850);

  t.mock.timers.tick(10);
  assert.ok(camera.accept({...cameraInput,sequence:3,capturedAt:5010,detector:'本帧无检测结果',detections:[]}));
  const betweenDetections=await frame();
  assert.equal(betweenDetections.stationaryFusion,'aligned');
  assert.ok(betweenDetections.field);
  assert.equal(betweenDetections.capture?.vision?.sequence,2);

  scans=[unmatched];
  const mismatched=await frame();
  assert.equal(mismatched.stationaryFusion,'waiting_for_sync');
  assert.equal(mismatched.field,null);
  scans=[{...sample,receivedAtMs:4759}];
  assert.equal((await frame()).stationaryFusion,'waiting_for_radar');

  scans=[sample];
  id=null;
  const moved=await frame();
  assert.equal(moved.stationaryFusion,'waiting_for_pose');
  assert.equal(moved.field,null);
});

test('vehicle input exposes live camera pixels and projected boxes without a pose', async t=>{
  t.mock.timers.enable({apis:['Date'],now:5000});
  const app=Fastify(), camera=new CameraFrameStore();
  t.after(()=>app.close());
  registerCameraFrames(app,camera);
  registerVehicleRisk(app,camera,JSON.stringify({
    width:320,height:240,cameraOffsetMs:0,alignmentWindowMs:100,
    points:[
      {u:0,v:0,x:0,y:0},{u:1,v:0,x:2,y:0},
      {u:1,v:1,x:2,y:2},{u:0,v:1,x:0,y:2},
    ],
  }));
  const jpeg=Buffer.from([255,216,12,34,255,217]);
  const detection={x:10,y:20,width:40,height:80,score:.91,label:'person',track_id:'V001'};
  assert.ok(camera.accept({sequence:8,capturedAt:5000,width:320,height:240,detector:'local',jpeg:jpeg.toString('base64'),detections:[detection]}));
  const frame=(await app.inject('/api/vehicle/frame')).json<VehicleResult>();
  assert.equal(frame.motion.action,'stop');
  assert.equal(frame.field,null);
  assert.deepEqual(frame.capture?.vision?.detections,[detection]);
  const ground = frame.observations.camera;
  assert.equal(ground?.sequence,8);
  assert.equal(ground.includedInFusion,false);
  assert.equal(ground.observations[0]?.trackId,'V001');
  assert.ok(Math.abs(ground.observations[0]!.xM - 60/320) < 1e-6);
  assert.ok(Math.abs(ground.observations[0]!.yM - 200/240) < 1e-6);
  const url=frame.capture!.vision!.imageUrl;
  const image=await app.inject(url+'?at=5000');
  assert.equal(image.headers['content-type'],'image/jpeg');
  assert.deepEqual(image.rawPayload,jpeg);
  assert.equal((await app.inject(url+'?at=4999')).statusCode,404);
  t.mock.timers.tick(251);
  const staleGround=(await app.inject('/api/vehicle/frame')).json<VehicleResult>();
  assert.equal(staleGround.observations.camera,null);
  assert.equal(staleGround.capture?.vision?.sequence,8);
  t.mock.timers.tick(1350);
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
