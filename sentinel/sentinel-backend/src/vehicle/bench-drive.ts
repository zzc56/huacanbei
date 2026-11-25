import type { BenchDriveStatus, DriveDirection, RadarStopMeasurement, StockTelemetry } from './contracts.js';
import { radarTrialSettings } from './contracts.js';
import type { StockTelemetryReader } from './stock-telemetry.js';

const { speedMmps, stopDistanceM } = radarTrialSettings;
const targetSpeedMps = speedMmps / 1000;
const heartbeatTimeoutMs = 250;
const resendMs = 75;
const measurementTimeoutMs = 3000;
type BenchTransport = Pick<StockTelemetryReader, 'freshForMotion' | 'radarForMotion' | 'wheelFeedbackForMotion' | 'setting' | 'send'>;
type RadarState = BenchDriveStatus['radarTrial']['state'];

export class BenchDrive {
  private direction: DriveDirection = 'stop';
  private phase: BenchDriveStatus['phase'] = 'arming';
  private message = '正在核对测试速度';
  private nextSendAt = 0;
  private deadline = 0;
  private originalSetting: number | undefined;
  private needsRelease = false;
  private radarState: RadarState = 'unavailable';
  private measurement: RadarStopMeasurement | undefined;
  private measurementStartedAt = 0;
  private standstillSweep: number | undefined;
  constructor(private serial: BenchTransport, private armedAt: number, sample: StockTelemetry['sample']) {
    const setting = serial.setting();
    if (!serial.freshForMotion(armedAt) || !sample || sample.wheelAMps !== 0 || sample.wheelBMps !== 0 ||
        !setting || armedAt - setting.readAt > 500) {
      this.fail('等待两路轮速归零及有效反馈');
    } else if (this.serial.radarForMotion(armedAt).status !== 'online') {
      this.fail('等待有效的车载雷达扫描');
    } else if (!serial.send('arm-radar')) this.fail('无法设置测试速度');
    else this.originalSetting = setting.mmps;
  }

  snapshot(now: number): BenchDriveStatus {
    if (this.phase !== 'stopped') this.update(now);
    this.updateMeasurement(now);
    const allowed = this.phase === 'ready' && this.radarState === 'clear';
    return { phase: this.phase, direction: this.direction, message: this.message,
      speedLimitMps: allowed ? targetSpeedMps : 0,
      targetSpeedMps,
      radarTrial: {
        state: this.radarState, stopDistanceM,
        ...(this.measurement && { measurement: this.measurement }),
      } };
  }

  command(action: DriveDirection | 'heartbeat', now: number) {
    if (action === 'stop') {
      if (this.direction !== 'stop' && !this.sendStop(now)) {
        this.fail('停车指令发送失败，已停止续发运动指令');
        return;
      }
      this.direction = 'stop';
      this.needsRelease = false;
      return;
    }
    if (this.phase !== 'ready') return;
    this.update(now);
    if (this.phase !== 'ready') return;
    if (this.radarState !== 'clear') {
      if (action === 'forward') this.needsRelease = true;
      return;
    }
    if (action === 'heartbeat' && this.direction === 'stop') return;
    this.deadline = now + heartbeatTimeoutMs;
    if (action === 'heartbeat') return;
    if (this.measurement?.status === 'measuring')
      this.measurement = { status: 'unavailable', message: '等待停稳期间重新启动，请重测' };
    this.direction = action;
    this.nextSendAt = now;
    this.update(now);
  }

  end(now: number, sample: StockTelemetry['sample']) {
    this.serial.send('stop');
    if (this.phase === 'ready' && this.serial.freshForMotion(now) &&
        sample?.wheelAMps === 0 && sample.wheelBMps === 0 && this.originalSetting !== undefined) {
      this.serial.send(`restore-${this.originalSetting}`);
    }
    this.direction = 'stop';
    this.phase = 'stopped';
  }

  private update(now: number) {
    const setting = this.serial.setting();
    if (!this.serial.freshForMotion(now)) {
      this.fail('轮速反馈中断，已撤销驱动');
      return;
    }
    if (this.phase === 'arming') {
      if (setting && setting.readAt > this.armedAt && setting.mmps === speedMmps) {
        this.phase = 'ready';
        this.message = '测试速度已确认';
      } else if (now - this.armedAt > 1500) this.fail(`小车未确认 ${targetSpeedMps.toFixed(2)} m/s，请检查 APP 控制模式`);
      return;
    }
    if (!setting || now - setting.readAt > 500 || setting.mmps !== speedMmps) {
      this.fail('实车速度设定失去确认');
      return;
    }
    if (!this.updateRadar(now)) return;
    if (this.direction !== 'stop') {
      if (now >= this.deadline) this.fail('键盘指令超时，已撤销驱动');
      else if (now >= this.nextSendAt) {
        if (!this.serial.send(this.direction)) this.fail('串口发送中断，已撤销驱动');
        else this.nextSendAt = now + resendMs;
      }
    }
  }

  private updateRadar(now: number) {
    const radar = this.serial.radarForMotion(now);
    if (radar.status !== 'online' || !radar.sample) {
      this.radarState = 'unavailable';
      this.fail('雷达扫描中断，已撤销驱动');
      return false;
    }
    const nearest = radar.sample.nearest;
    if (nearest && nearest.rangeM <= stopDistanceM) {
      this.radarState = 'obstacle';
      this.message = `前方障碍 ${nearest.rangeM.toFixed(2)} m`;
      if (this.direction === 'forward') this.blockForward(now);
    } else if (this.needsRelease) {
      this.radarState = 'release';
      this.message = '松开前进键后重新按下';
    } else {
      this.radarState = 'clear';
      this.message = '雷达在线 · 按住 W 前进';
    }
    return this.radarState === 'clear';
  }

  private sendStop(now: number) {
    const sent = this.serial.send('stop');
    if (sent && this.direction === 'forward') {
      const before = this.serial.radarForMotion(now).sample?.nearest;
      const wheels = this.serial.wheelFeedbackForMotion(now);
      const wheelSpeedMps = wheels ? (Math.abs(wheels.wheelAMps) + Math.abs(wheels.wheelBMps)) / 2 : 0;
      if (before && wheelSpeedMps > 0) {
        this.measurement = { status: 'measuring', beforeM: before.rangeM, wheelSpeedMps };
        this.measurementStartedAt = now;
        this.standstillSweep = undefined;
      } else {
        this.measurement = { status: 'unavailable', message: '发出停车指令时缺少有效目标距离或行驶轮速' };
      }
    }
    return sent;
  }

  private updateMeasurement(now: number) {
    if (this.measurement?.status !== 'measuring') return;
    if (now - this.measurementStartedAt >= measurementTimeoutMs) {
      this.measurement = { status: 'unavailable', message: '测距超时，请确认两路轮速归零且箱子仍有回波' };
      return;
    }
    const wheels = this.serial.wheelFeedbackForMotion(now);
    const scan = this.serial.radarForMotion(now).sample;
    if (!wheels || wheels.wheelAMps !== 0 || wheels.wheelBMps !== 0 || !scan) {
      this.standstillSweep = undefined;
      return;
    }
    this.standstillSweep ??= scan.sequence;
    // Skip the sweep that may already have started when the wheels stopped.
    const sweeps = (scan.sequence - this.standstillSweep) >>> 0;
    if (sweeps < 2 || sweeps >= 0x80000000 || !scan.nearest) return;
    this.measurement = { ...this.measurement, status: 'complete', afterM: scan.nearest.rangeM,
      reductionM: this.measurement.beforeM - scan.nearest.rangeM };
  }

  private blockForward(now: number) {
    if (this.direction !== 'stop' && !this.sendStop(now)) {
      this.fail('停车指令发送失败，已停止续发运动指令');
      return;
    }
    this.direction = 'stop';
    this.needsRelease = true;
  }

  private fail(reason: string) {
    this.serial.send('stop');
    this.direction = 'stop';
    this.phase = 'stopped';
    this.message = reason;
    if (this.measurement?.status === 'measuring')
      this.measurement = { status: 'unavailable', message: reason };
  }
}
