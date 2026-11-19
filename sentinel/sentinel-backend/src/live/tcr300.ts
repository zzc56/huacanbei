/** TCR300-Self TCP framing and kinematics, verified against all 483 saved vendor callbacks.
 * Units/axis signs still require field calibration. Unsupported class/confidence are omitted.
 */
export interface RadarObservation {
  target_seq: number; track_id: number; host_received_utc: string;
  x_lateral: number; y_longitudinal: number; vx_lateral: number; vy_longitudinal: number;
  range: number; angle: number; rcs: number;
}
export type RadarMessage =
  | { type: 'cycle'; count: number; counter: number }
  | { type: 'target'; target: Omit<RadarObservation, 'target_seq' | 'host_received_utc'> };

export class Tcr300Decoder {
  private pending = Buffer.alloc(0);
  reset() { this.pending = Buffer.alloc(0); }
  push(chunk: Buffer): RadarMessage[] {
    const data = Buffer.concat([this.pending, chunk]), messages: RadarMessage[] = [];
    let offset = 0;
    while (offset + 14 <= data.length) {
      if (data[offset] !== 0xaa || data[offset + 1] !== 0xaa ||
          data[offset + 12] !== 0x55 || data[offset + 13] !== 0x55) { offset++; continue; }
      const id = data.readUInt16LE(offset + 2), d = data.subarray(offset + 4, offset + 12);
      if (id === 0x60a) messages.push({ type: 'cycle', count: d[0]!, counter: d.readUInt16BE(1) });
      if (id === 0x60b) {
        const x = (((d[2]! & 7) << 8) | d[3]!) * .2 - 204.6;
        const y = ((d[1]! << 5) | (d[2]! >> 3)) * .2 - 500;
        const vx = (((d[5]! & 63) << 3) | (d[6]! >> 5)) * .25 - 64;
        const vy = ((d[4]! << 2) | (d[5]! >> 6)) * .25 - 128;
        messages.push({ type: 'target', target: {
          track_id: d[0]!, x_lateral: x, y_longitudinal: y, vx_lateral: vx, vy_longitudinal: vy,
          range: Math.hypot(x, y), angle: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360,
          rcs: d[7]! * .5 - 64,
        } });
      }
      offset += 14;
    }
    this.pending = Buffer.from(data.subarray(offset));
    return messages;
  }
}
