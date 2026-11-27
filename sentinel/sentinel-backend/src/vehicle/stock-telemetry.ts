import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { StockTelemetry } from './contracts.js';
import { radarTrialSettings, wheelFeedbackMaxAgeMs } from './contracts.js';
import { StockLidarReader } from './stock-lidar.js';

// The app selects from a fixed set of Bluetooth commands. Movement queued in
// the pipe past its deadline is discarded rather than sent late to the car.
const serialBridge = String.raw`
$ErrorActionPreference = 'Stop'
$hostProcess = [Diagnostics.Process]::GetProcessById([int]$env:SENTINEL_TELEMETRY_PARENT)
$port = [IO.Ports.SerialPort]::new($env:SENTINEL_VEHICLE_PORT)
$port.WriteTimeout = 150
$inputStream = [IO.StreamReader]::new([Console]::OpenStandardInput())
try {
  $port.Open()
  $command = $inputStream.ReadLineAsync()
  while (-not $hostProcess.HasExited) {
    while ($command.IsCompleted) {
      $line = $command.GetAwaiter().GetResult()
      if ($null -eq $line) { return }
      if ($line -eq 'close') { $port.Write('I'); return }
      if ($line -eq 'stop') { $port.Write('I') }
      elseif ($line -match '^(\d+):(arm-radar|forward|restore-\d{1,4})$' -and
        [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt [long]$Matches[1]) {
        $action = $Matches[2]
        switch ($action) {
          'arm-radar' { $port.Write('KI{0:${radarTrialSettings.speedMmps}}I') }
          'forward' { $port.Write('A') }
          default { $port.Write(('I{0:'+$action.Substring(8)+'}I')) }
        }
      }
      $command = $inputStream.ReadLineAsync()
    }
    $data = $port.ReadExisting()
    if ($data.Length) { [Console]::Out.Write($data); [Console]::Out.Flush() }
    Start-Sleep -Milliseconds 15
  }
} finally { $port.Dispose(); $inputStream.Dispose() }
`;

const staleAfterMs = 1200;
const radarMotionFreshnessMs = 450;

export class StockTelemetryReader {
  private child: ChildProcess | undefined;
  private pending = '';
  private latest: StockTelemetry['sample'] = null;
  private lastFrameAt = 0;
  private stationary: {id:string; sinceMs:number} | null = null;
  private status: StockTelemetry['status'] = 'idle';
  private traceStartedAt = 0;
  private settingValue: { mmps: number; readAt: number } | null = null;
  private closing = false;
  private lidar = new StockLidarReader();

  constructor(readonly port: string) {}

  start() {
    if (this.child) return;
    if (process.platform !== 'win32' || !/^COM[1-9]\d{0,2}$/i.test(this.port)) {
      this.status = 'error';
      return;
    }
    this.status = 'connecting';
    this.traceStartedAt = performance.now();
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', serialBridge], {
      env: { ...process.env, SENTINEL_VEHICLE_PORT: this.port, SENTINEL_TELEMETRY_PARENT: String(process.pid) },
      stdio: ['pipe','pipe','pipe'],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding('ascii').on('data', (chunk: string) => {
      if (child === this.child && !this.closing) this.receive(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    const failed = () => {
      if (child !== this.child) return;
      this.child = undefined;
      this.latest = null;
      this.settingValue = null;
      this.status = this.closing ? 'idle' : 'error';
      this.closing = false;
    };
    child.once('error', failed);
    child.once('close', failed);
  }

  private receive(chunk: string) {
    this.pending += chunk;
    const frames = this.pending.matchAll(/\{(?:A(\d{1,3}):(\d{1,3}):(-?\d{1,3}):\1:\2|B(\d{1,4}):(\d{1,3}):(\d{1,3})|R[MN]?[0-9:-]{1,95})\}\$/g);
    let consumed = 0;
    for (const frame of frames) {
      consumed = frame.index + frame[0].length;
      if (frame[0][1] === 'R') {
        this.lidar.receive(frame[0], performance.now(), Date.now());
        continue;
      }
      // A and B alternate. In the stock protocol both carry measured wheel speeds.
      const a = Number(frame[1] ?? frame[5]), b = Number(frame[2] ?? frame[6]);
      if (a > 255 || b > 255) continue;
      const now = performance.now(), receivedAtMs = Date.now();
      if (frame[4] !== undefined) this.settingValue = { mmps: Number(frame[4]), readAt: now };
      const battery = frame[3] !== undefined ? Number(frame[3]) : this.latest?.batteryPercent ?? null;
      if (a !== 0 || b !== 0) this.stationary = null;
      else if (!this.stationary || !this.freshForMotion(now))
        this.stationary = {id:randomUUID(), sinceMs:receivedAtMs};
      this.latest = { wheelAMps: a / 100, wheelBMps: b / 100,
        batteryPercent: battery !== null && battery >= 0 && battery <= 100 ? battery : null, receivedAtMs };
      this.lastFrameAt = now;
      this.status = 'online';
    }
    this.pending = this.pending.slice(Math.max(consumed, this.pending.length - 100));
  }

  setting() { return this.settingValue; }

  freshForMotion(now: number) {
    return this.status === 'online' && this.latest !== null && now - this.lastFrameAt <= wheelFeedbackMaxAgeMs;
  }

  wheelFeedbackForMotion(now: number) { return this.freshForMotion(now) ? this.latest : null; }

  stationaryForMotion(now: number) { return this.freshForMotion(now) ? this.stationary : null; }

  radarForMotion(now: number) { return this.lidar.snapshot(now, radarMotionFreshnessMs); }

  radarHistory(now: number) { return this.lidar.recentScans(now, radarMotionFreshnessMs); }

  send(action: 'arm-radar' | 'forward' | 'stop' | `restore-${number}`) {
    const stream = this.child?.stdin;
    if (!stream?.writable || this.closing) return false;
    if (action !== 'stop' && stream.writableLength !== 0) return false;
    stream.write(action === 'stop' ? 'stop\n' : (Date.now() + 150) + ':' + action + '\n');
    return true;
  }

  snapshot(): StockTelemetry {
    const now = performance.now();
    if (this.status === 'connecting' && now - this.traceStartedAt > 15_000) {
      this.close();
      this.status = 'error';
    }
    if (this.status === 'online' && now - this.lastFrameAt > staleAfterMs)
      return { port: this.port, status: 'stale', sample: null, lidar: this.lidar.snapshot(now) };
    const readyForRadarTrial = this.freshForMotion(now) && this.latest?.wheelAMps === 0 && this.latest.wheelBMps === 0 &&
      this.settingValue !== null && now - this.settingValue.readAt <= 500 && this.radarForMotion(now).status === 'online';
    const stationary = this.stationaryForMotion(now);
    return {
      port: this.port, status: this.status, sample: this.latest,
      ...(this.status === 'idle' ? {} : { lidar: this.lidar.snapshot(now) }),
      ...(stationary && {stationaryId:stationary.id}),
      readyForRadarTrial,
    };
  }

  close(stop = false) {
    const child = this.child;
    this.pending = '';
    this.latest = null;
    this.stationary = null;
    this.settingValue = null;
    this.lidar = new StockLidarReader();
    this.status = 'idle';
    if (!child || this.closing) return;
    this.closing = true;
    if (stop && child.stdin?.writable) {
      child.stdin.end('close\n');
      const forceClose = setTimeout(() => child.kill(), 400);
      child.once('close', () => clearTimeout(forceClose));
    } else child.kill();
  }
}
