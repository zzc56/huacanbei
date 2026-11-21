import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { SimulatedDrive, driveTimeoutMs } from '../src/vehicle/drive.js';
import type { DriveSnapshot } from '../src/vehicle/contracts.js';

test('movement uses the applied speed, each sensor is independent, and holding forward cannot pass the stop', () => {
  const drive = new SimulatedDrive(0);
  drive.command('forward', 0);
  const stages = new Set<string>();
  for (let t = 0; t < 7000; t += 100) {
    drive.command('heartbeat', t);
    const {frame, speedMps} = drive.snapshot(t,t);
    stages.add([frame.cameraCount, frame.lidarCount, frame.obstacles.length, speedMps].join('/'));
  }
  assert.deepEqual([...stages], ['0/0/0/0.22', '1/0/1/0.1', '1/1/1/0.1', '1/1/1/0']);
  assert.ok(Math.abs(drive.snapshot(7000,7000).travelM - .75) < 1e-9);
  drive.command('reverse', 7000);
  assert.equal(drive.snapshot(7100,7100).speedMps, -.1);
  drive.command('stop', 7100);
  assert.ok(Math.abs(drive.snapshot(12000,12000).travelM - .74) < 1e-9);
  drive.command('reset', 12001);
  assert.equal(drive.snapshot(13000,13000).travelM, 0);
});

test('a late heartbeat cannot revive expired movement or integrate beyond the deadline', () => {
  const drive = new SimulatedDrive(0);
  drive.command('forward',0);
  drive.command('heartbeat',driveTimeoutMs + 2000);
  const state = drive.snapshot(5000,5000);
  assert.equal(state.speedMps,0);
  assert.equal(state.timedOut,true);
  assert.ok(Math.abs(state.travelM - .22 * driveTimeoutMs / 1000) < 1e-9);
});

test('server stops without a browser heartbeat while the socket is still open', {timeout:6000}, async () => {
  const app = buildApp('vehicle');
  await app.listen({host:'127.0.0.1',port:0});
  const ws = new WebSocket(app.listeningOrigin.replace('http:','ws:')+'/api/vehicle/drive');
  try {
    await once(ws,'open');
    const expired = new Promise<DriveSnapshot>(resolve => ws.on('message', data => {
      const state = JSON.parse(data.toString()) as DriveSnapshot;
      if (state.timedOut) resolve(state);
    }));
    ws.send('forward');
    const stopped = await expired;
    assert.equal(stopped.direction,'stop');
    assert.equal(stopped.speedMps,0);
    assert.ok(stopped.travelM > 0 && stopped.travelM <= .10);
    const [next] = await once(ws,'message');
    assert.equal(JSON.parse(next.toString()).travelM, stopped.travelM);
  } finally {
    ws.terminate();
    await app.close();
  }
});
