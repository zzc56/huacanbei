import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { config } from '../config.js';
import type { FrameData, WorkerCommand, WorkerOutput } from '../contracts.js';
import { SensorSimulator } from '../simulator/sensor.simulator.js';
import { FusionEngine } from '../engines/fusion.engine.js';
import { RiskFieldEngine } from '../engines/risk-field.engine.js';

if (!parentPort) throw new Error('Pipeline must run inside a worker');
const port = parentPort;
const source = new SensorSimulator(), fusion = new FusionEngine(), risk = new RiskFieldEngine();
const interval = 1000 / config.sensorHz;
let playing = true, simulationMs = 0, previous = 0, sequence = 0;
let deadline = performance.now() + interval;
let timer: NodeJS.Timeout;
const post = (output: WorkerOutput): void => port.postMessage(output);
function tick(): void {
  if (playing) {
    simulationMs += interval;
    const observation = source.sample(interval / 1000, simulationMs);
    const result = fusion.update(observation), computed = risk.compute(result.targets);
    const now = performance.now();
    const frame: FrameData = { timestamp: Date.now(), fps: previous ? 1000 / (now - previous) : config.sensorHz, targets: result.targets, riskField: computed.field };
    previous = now;
    const json = JSON.stringify(frame);
    if (Buffer.byteLength(json) > config.maxFrameBytes) throw new Error('Frame exceeds bounded JSON budget');
    const contourDue = ++sequence % 5 === 0;
    post({ type: 'frame', frame, json, statuses: result.statuses, contours: contourDue ? computed.contours : [], contourDue });
  }
  // 绝对截止时间避免累计漂移；超时跳过调度槽，不循环补发陈旧帧。
  // 仿真每次仍只前进 0.1s，机器过载时仿真变慢；不以大 dt 导致轨迹跳跃。
  deadline += interval;
  if (deadline < performance.now()) deadline = performance.now() + interval;
  timer = setTimeout(tick, Math.max(1, deadline - performance.now()));
}
port.on('message', (command: WorkerCommand) => {
  if (command.action === 'reset') { source.reset(); fusion.reset(); simulationMs = 0; sequence = 0; previous = 0; }
  if (command.action === 'pause') { playing = false; previous = 0; }
  if (command.action === 'play') { playing = true; previous = 0; }
  post({ type: 'ack', requestId: command.requestId, state: playing ? 'playing' : 'paused' });
});
port.on('close', () => clearTimeout(timer));
timer = setTimeout(tick, interval);
