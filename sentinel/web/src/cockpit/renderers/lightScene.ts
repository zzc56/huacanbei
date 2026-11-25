import type { Target, WorldBounds } from '../types';
import { cameraGround } from '../core/fusion';
import { targetDisplayName } from '../core/targetLabels';
export type ViewMode = 'radar' | 'camera' | 'risk';
export type PlotBounds = WorldBounds;
export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export const ink = '#092d4c',
  teal = '#008e8c',
  warm = '#d64e35';
export const riskTone = (t: Target) =>
  (t.risk?.value ?? 0) >= 0.75 ? warm : (t.risk?.value ?? 0) >= 0.4 ? '#a77c12' : teal;
export function text(
  c: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  color = ink,
  size = 12,
  align: CanvasTextAlign = 'left',
) {
  c.font = `600 ${size}px "DIN Alternate", "Segoe UI", "Microsoft YaHei", sans-serif`;
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(value, x, y);
}
export function line(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color: string,
  width = 1,
) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function polygon(c: CanvasRenderingContext2D, points: number[][], fill: string, stroke?: string) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = 0.7;
    c.stroke();
  }
}
export function groundMap(w: number, h: number, bounds?: PlotBounds) {
  if(bounds) {
    const fitX=Math.max(.001,(w-Math.min(100,w*.12))/(bounds.xMax-bounds.xMin));
    const fitY=Math.max(.001,(h-Math.min(100,h*.15))/(bounds.yMax-bounds.yMin));
    // A metre must occupy the same pixels on both axes, including in overview.
    const scale=Math.min(fitX,fitY),scaleX=scale,scaleY=scale;
    const cx=(bounds.xMin+bounds.xMax)/2,cy=(bounds.yMin+bounds.yMax)/2;
    return {map:(x:number,y:number):[number,number]=>[w/2+(x-cx)*scaleX,h/2-(y-cy)*scaleY],scale,scaleX,scaleY};
  }
  const scale = Math.min(w / 430, h / 430);
  return {
    map: (x: number, y: number): [number, number] => [w * 0.5 + x * scale, h * 0.53 - y * scale],
    scale, scaleX: scale, scaleY: scale,
  };
}
/** Sensor-local drawing sheet. No invented street geometry or geographic calibration. */
export function paintMeasuredMap(c:CanvasRenderingContext2D,w:number,h:number,bounds:PlotBounds) {
  c.fillStyle='#e0eff0';c.fillRect(0,0,w,h);
  const {map,scaleX,scaleY}=groundMap(w,h,bounds);
  const stepFor=(scale:number,pixels:number)=>{const min=pixels/scale,m=10**Math.floor(Math.log10(min));return [1,2,5,10].map(n=>n*m).find(n=>n>=min)!;};
  const stepX=stepFor(scaleX,42),stepY=stepFor(scaleY,28);
  for(let x=Math.ceil(bounds.xMin/stepX)*stepX;x<=bounds.xMax;x+=stepX){const a=map(x,bounds.yMin),b=map(x,bounds.yMax);line(c,...a,...b,'#80acb53d',.8);text(c,x+'',a[0],a[1]+20,'#466e82',10,'center');}
  for(let y=Math.ceil(bounds.yMin/stepY)*stepY;y<=bounds.yMax;y+=stepY){const a=map(bounds.xMin,y),b=map(bounds.xMax,y);line(c,...a,...b,'#80acb53d',.8);text(c,y+' m',a[0]-8,a[1]+4,'#466e82',10,'right');}
  const [ox,oy]=map(0,0);line(c,ox-6,oy,ox+6,oy,'#368a91');line(c,ox,oy-6,ox,oy+6,'#368a91');
}
/** 静态图层按尺寸缓存；动态目标和场值另行绘制。 */
export function paintMap(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#c9e2e7';
  c.fillRect(0, 0, w, h);
  const { map } = groundMap(w, h);
  const poly = (pts: number[][], fill: string, stroke?: string) =>
    polygon(
      c,
      pts.map((p) => map(p[0], p[1])),
      fill,
      stroke,
    );
  // 高位城市地图：街区、错层楼体、林带和弯曲河道。
  c.save();
  c.beginPath();
  for (let i = 0; i <= 50; i++) {
    const y = -260 + i * 10;
    const [x, py] = map(-135 + 30 * Math.sin(y / 70), y);
    i ? c.lineTo(x, py) : c.moveTo(x, py);
  }
  c.strokeStyle = '#5cc7cb';
  c.lineWidth = 38;
  c.stroke();
  c.strokeStyle = '#a6e4e8';
  c.lineWidth = 26;
  c.stroke();
  c.restore();
  for (const x of [-85, 75])
    poly(
      [
        [x - 12, -240],
        [x + 12, -240],
        [x + 12, 240],
        [x - 12, 240],
      ],
      '#9fbac7',
      '#f9fdfc',
    );
  for (const y of [-130, -20, 110])
    poly(
      [
        [-250, y - 9],
        [250, y - 9],
        [250, y + 9],
        [-250, y + 9],
      ],
      '#a9c3ce',
      '#ffffff',
    );
  for (let i = 0; i < 100; i++) {
    const x = -240 + (i % 10) * 52 + Math.sin(i * 3) * 5,
      y = -235 + Math.floor(i / 10) * 49;
    if (
      Math.abs(x + 85) < 28 ||
      Math.abs(x - 75) < 28 ||
      Math.abs(x + 135 - 30 * Math.sin(y / 70)) < 23 ||
      [-130, -20, 110].some((a) => Math.abs(a - y) < 20)
    )
      continue;
    const size = 15 + (i % 4) * 3;
    poly(
      [
        [x + 4, y - 4],
        [x + size + 4, y - 4],
        [x + size + 4, y + size - 4],
        [x + 4, y + size - 4],
      ],
      '#5a839d66',
    );
    poly(
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
      ],
      '#f9fcfb',
      '#7ba8be',
    );
    poly(
      [
        [x, y],
        [x + size, y],
        [x + size + 3, y - 4],
        [x + 3, y - 4],
      ],
      '#86aabb',
    );
    const [a, b] = map(x + 4, y + size - 4);
    c.fillStyle = '#bddbe4';
    c.fillRect(a, b, Math.max(3, size * 0.9), 2);
  }
  for (let i = 0; i < 350; i++) {
    const x = 230 * Math.sin(i * 19.7),
      y = 240 * Math.cos(i * 12.4);
    if (
      Math.abs(x + 85) < 15 ||
      Math.abs(x - 75) < 15 ||
      [-130, -20, 110].some((a) => Math.abs(a - y) < 13)
    )
      continue;
    const [px, py] = map(x, y);
    c.beginPath();
    c.arc(px, py, 1.4 + (i % 4) * 0.6, 0, Math.PI * 2);
    c.fillStyle = i % 3 ? '#278f87aa' : '#237a75a0';
    c.fill();
  }
  c.fillStyle = '#e4faff0a';
  c.fillRect(0, 0, w, h);
}
export function paintCamera(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#d5e9ee';
  c.fillRect(0, 0, w, h);
  const map = (x: number, y: number, z = 0): [number, number] => {
    const [a, b] = cameraGround(x, y);
    return [a * w, b * h - z * h * 0.0015];
  };
  const poly = (p: number[][], color: string, stroke?: string) =>
    polygon(
      c,
      p.map((q) => map(q[0], q[1], q[2] || 0)),
      color,
      stroke,
    );
  // 宽阔的双向道路与中央绿化带。
  poly(
    [
      [-111, -60],
      [111, -60],
      [111, 300],
      [-111, 300],
    ],
    '#859eaf',
    '#fcffff',
  );
  poly(
    [
      [-105, -60],
      [105, -60],
      [105, 300],
      [-105, 300],
    ],
    '#9bb4c2',
  );
  poly(
    [
      [-250, 103],
      [250, 103],
      [250, 140],
      [-250, 140],
    ],
    '#8faab9',
    '#f8fbfb',
  );
  for (const x of [-95, -65, -30, 30, 65, 95]) {
    for (let y = -45; y < 290; y += 22) {
      if (y > 90 && y < 155) continue;
      const a = map(x, y),
        b = map(x, y + 10);
      line(c, ...a, ...b, '#f9fdfccc', x === -95 || x === 95 ? 2 : 1.4);
    }
  }
  poly(
    [
      [-4, -60],
      [4, -60],
      [4, 92],
      [-4, 92],
    ],
    '#75ad9d',
  );
  poly(
    [
      [-4, 155],
      [4, 155],
      [4, 300],
      [-4, 300],
    ],
    '#75ad9d',
  );
  for (const y of [92, 149]) {
    for (let x = -97; x < 100; x += 9)
      poly(
        [
          [x, y],
          [x + 5, y],
          [x + 5, y + 11],
          [x, y + 11],
        ],
        '#f8faf5',
      );
  }
  for (let x = -87; x < 100; x += 35) {
    const p = map(x, 42);
    c.save();
    c.translate(...p);
    c.strokeStyle = '#f5faf8';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -26);
    c.moveTo(-5, -20);
    c.lineTo(0, -26);
    c.lineTo(5, -20);
    c.stroke();
    c.restore();
  }
  // 按远近绘制楼体，保留干净的平面结构和细窗格。
  for (let j = 0; j < 6; j++)
    for (const side of [-1, 1]) {
      const y = 245 - j * 58,
        x = side < 0 ? -202 : -0 + 124,
        bw = 42 + (j % 2) * 17,
        bh = 26 + (j % 3) * 12,
        z = 16 + (j % 3) * 18;
      poly(
        [
          [x + 8, y - 8],
          [x + bw + 10, y - 8],
          [x + bw + 10, y + bh - 8],
          [x + 8, y + bh - 8],
        ],
        '#396b8b45',
      );
      poly(
        [
          [x, y, 0],
          [x + bw, y, 0],
          [x + bw, y, z],
          [x, y, z],
        ],
        '#9bbdce',
        '#7196b0',
      );
      poly(
        [
          [x + bw, y, 0],
          [x + bw, y + bh, 0],
          [x + bw, y + bh, z],
          [x + bw, y, z],
        ],
        '#7fa7be',
        '#638da8',
      );
      poly(
        [
          [x, y, z],
          [x + bw, y, z],
          [x + bw, y + bh, z],
          [x, y + bh, z],
        ],
        '#f9fcfc',
        '#7ca7c0',
      );
      poly(
        [
          [x + 5, y + 5, z + 0.5],
          [x + bw - 5, y + 5, z + 0.5],
          [x + bw - 5, y + bh - 5, z + 0.5],
          [x + 5, y + bh - 5, z + 0.5],
        ],
        '#d1e8f3',
        '#93b9cf',
      );
      for (let floor = 6; floor < z; floor += 7) {
        const a = map(x, y, floor),
          b = map(x + bw, y, floor);
        line(c, ...a, ...b, '#eff7f5', 1);
      }
      for (let col = 5; col < bw; col += 8) {
        const a = map(x + col, y, 2),
          b = map(x + col, y, z - 2);
        line(c, ...a, ...b, '#e6f0ee', 1);
      }
    }
  for (const x of [-116, 116])
    for (let y = -40; y < 290; y += 18) {
      if (y > 94 && y < 154) continue;
      const [px, py] = map(x, y),
        r = 4 + (220 - y) * 0.016;
      c.beginPath();
      c.ellipse(px + 4, py + 4, r * 1.2, r * 0.6, 0, 0, Math.PI * 2);
      c.fillStyle = '#698e8520';
      c.fill();
      line(c, px, py, px, py - 7, '#97b1a5', 1);
      c.beginPath();
      c.arc(px, py - 8, r, 0, Math.PI * 2);
      c.fillStyle = '#6fae9c';
      c.fill();
      c.strokeStyle = '#96b5aa55';
      c.stroke();
      c.beginPath();
      c.arc(px - 1, py - 10, r * 0.7, 0, Math.PI * 2);
      c.fillStyle = '#9bd4bd';
      c.fill();
    }
  for (let y = -15; y < 270; y += 35) {
    const [px, py] = map(0, y);
    c.beginPath();
    c.ellipse(px, py, 2, 4, 0, 0, Math.PI * 2);
    c.fillStyle = '#438a79';
    c.fill();
  }
  // 停车位和静态背景车辆不参与检测统计。
  for (const side of [-1, 1])
    for (let j = 0; j < 8; j++) {
      const y = 20 + j * 24;
      if (y > 95 && y < 155) continue;
      const [px, py] = map(side * 138, y);
      c.fillStyle = '#c1cfd0';
      c.fillRect(px - 4, py - 9, 8, 16);
      c.strokeStyle = '#f5fbfa';
      c.strokeRect(px - 4, py - 9, 8, 16);
    }
  const haze = c.createLinearGradient(0, 0, 0, h);
  haze.addColorStop(0, '#effaff22');
  haze.addColorStop(0.5, '#f8ffff00');
  haze.addColorStop(1, '#eff8f600');
  c.fillStyle = haze;
  c.fillRect(0, 0, w, h);
}
export function cameraTargets(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  targets: Target[],
  selectedId: string,
  mock: boolean,
  box = { x: 0, y: 0, w, h },
  showClassConfidence = false,
  drawBoxes = true,
): Hit[] {
  const hits: Hit[] = [];
  for (const t of [...targets].sort(
    (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
  )) {
    if (!t.camera) continue;
    const [nx, ny, nw, nh] = t.camera.bbox,
      x = box.x + nx * box.w,
      y = box.y + ny * box.h,
      bw = nw * box.w,
      bh = nh * box.h;
    if (x + bw < 0 || x > w || y + bh < 0 || y > h) continue;
    const selected = t.id === selectedId,
      color = riskTone(t), pad = mock ? 5 : 0;
    if (mock && t.camera.class === 'person') {
      c.beginPath();
      c.arc(x + bw * 0.5, y + bh * 0.15, bw * 0.22, 0, Math.PI * 2);
      c.fillStyle = '#3c6478';
      c.fill();
      line(c, x + bw * 0.5, y + bh * 0.33, x + bw * 0.5, y + bh * 0.65, '#507e8e', bw * 0.3);
      line(c, x + bw * 0.5, y + bh * 0.6, x + bw * 0.27, y + bh * 0.96, '#3c6478', bw * 0.15);
      line(c, x + bw * 0.5, y + bh * 0.6, x + bw * 0.72, y + bh * 0.96, '#3c6478', bw * 0.15);
      line(c, x + bw * 0.1, y + bh * 0.58, x + bw * 0.5, y + bh * 0.36, '#3c6478', bw * 0.13);
      line(c, x + bw * 0.9, y + bh * 0.58, x + bw * 0.5, y + bh * 0.36, '#3c6478', bw * 0.13);
    } else if (mock) {
      c.save();
      c.shadowColor = '#56777835';
      c.shadowBlur = 9;
      c.shadowOffsetX = 5;
      c.shadowOffsetY = 5;
      c.fillStyle = selected ? '#d6eaf2' : '#bfd5df';
      c.beginPath();
      c.roundRect(x + bw * 0.18, y + bh * 0.06, bw * 0.64, bh * 0.88, 5);
      c.fill();
      c.restore();
      c.strokeStyle = '#96aaad';
      c.lineWidth = 0.8;
      c.strokeRect(x + bw * 0.22, y + bh * 0.1, bw * 0.56, bh * 0.8);
      c.fillStyle = '#3c667e';
      c.fillRect(x + bw * 0.25, y + bh * 0.2, bw * 0.5, bh * 0.18);
      c.fillStyle = '#f2f7f5';
      c.fillRect(x + bw * 0.25, y + bh * 0.4, bw * 0.5, bh * 0.3);
      c.fillStyle = '#739bad';
      c.fillRect(x + bw * 0.25, y + bh * 0.72, bw * 0.5, bh * 0.11);
      for (const sx of [0.15, 0.77])
        for (const sy of [0.2, 0.72]) {
          c.fillStyle = '#7f9396';
          c.fillRect(x + bw * sx, y + bh * sy, bw * 0.08, bh * 0.15);
        }
    }
    if (showClassConfidence) {
      c.save();
      c.strokeStyle = '#29afe0';
      c.lineWidth = selected ? 1.8 : 1;
      c.strokeRect(x, y, bw, bh);
      const size = Math.max(10, Math.min(19, 16 * box.w / 800));
      c.font = `400 ${size}px "Segoe UI", sans-serif`;
      c.textAlign = 'left';
      c.fillStyle = c.strokeStyle;
      const name = targetDisplayName(t, { showVisualNumber: false });
      const label = t.camera.previewOnly ? `${name} · 预览` : `${name} ${Math.round(t.camera.confidence * 100)}%`;
      const labelX = Math.max(0, Math.min(w - c.measureText(label).width, x));
      c.fillText(label, labelX, Math.max(size, y - 4));
      c.restore();
    } else if (drawBoxes || selected) {
      c.strokeStyle = color + (selected ? 'ff' : 'b0');
      c.lineWidth = selected ? 1.8 : 1.1;
      c.strokeRect(x - pad, y - pad, bw + pad * 2, bh + pad * 2);
      const k = Math.min(11, bw * 0.35);
      for (const [cx, cy, dx, dy] of [
        [x - pad, y - pad, 1, 1],
        [x + bw + pad, y - pad, -1, 1],
        [x - pad, y + bh + pad, 1, -1],
        [x + bw + pad, y + bh + pad, -1, -1],
      ]) {
        line(c, cx, cy, cx + k * dx, cy, color, selected ? 2 : 1.3);
        line(c, cx, cy, cx, cy + k * dy, color, selected ? 2 : 1.3);
      }
    }
    const left = Math.max(0, x - pad - 4), top = Math.max(0, y - pad - 4);
    const right = Math.min(w, x + bw + pad + 4), bottom = Math.min(h, y + bh + pad + 4);
    hits.push({ id: t.id, x: left, y: top, w: right - left, h: bottom - top });
  }
  return hits;
}
export function mapTargets(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  targets: Target[],
  selectedId: string,
  mode: ViewMode,
  trails: boolean,
  bounds?: PlotBounds,
  labelsVisible = true,
): Hit[] {
  const { map } = groundMap(w, h, bounds);
  const hits: Hit[] = [];
  const labels: { x: number; y: number }[] = [];
  for (const t of [...targets].sort(
    (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
  )) {
    if (mode === 'radar' && !t.radar) continue;
    const polar = mode==='radar' && t.radar ? {x:t.radar.range*Math.sin(t.radar.azimuth*Math.PI/180),y:t.radar.range*Math.cos(t.radar.azimuth*Math.PI/180)} : t.fusion;
    if (!polar) continue;
    const [x, y] = map(polar.x, polar.y),
      color = riskTone(t),
      selected = t.id === selectedId;
    if (trails) {
      c.beginPath();
      t.history?.forEach((p, i) => {
        const [a, b] = map(p.x, p.y);
        i ? c.lineTo(a, b) : c.moveTo(a, b);
      });
      c.strokeStyle = color + '90';
      c.lineWidth = 1.3;
      c.setLineDash([2, 4]);
      c.stroke();
      c.setLineDash([]);
    }
    if (selected) {
      c.beginPath();
      c.arc(x, y, 15, 0, Math.PI * 2);
      c.strokeStyle = color + '80';
      c.lineWidth = 1;
      c.stroke();
      line(c, x - 22, y, x - 17, y, color);
      line(c, x + 17, y, x + 22, y, color);
      line(c, x, y - 22, x, y - 17, color);
    }
    c.beginPath();
    c.arc(x, y, 5, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.stroke();
    hits.push({ id: t.id, x: x - 15, y: y - 15, w: 30, h: 30 });
    if (!labelsVisible) continue;
    const candidates = [
      [x + 13, y - 12],
      [x + 13, y + 42],
      [x - 122, y - 12],
      [x - 122, y + 42],
      [x + 13, y - 68],
    ].map(([a, b]) => ({
      x: Math.max(12, Math.min(w - 120, a)),
      y: Math.max(75, Math.min(h - 60, b)),
    }));
    const chosen =
      candidates.find((p) =>
        labels.every((q) => Math.abs(p.x - q.x) > 114 || Math.abs(p.y - q.y) > 49),
      ) || candidates[0];
    const tx = chosen.x,
      ty = chosen.y;
    labels.push(chosen);
    if (chosen !== candidates[0]) line(c, x, y, tx + 54, ty - 8, color + '50', 0.7);
    c.save();
    c.shadowColor = '#567b6d10';
    c.shadowBlur = 10;
    c.fillStyle = selected ? '#fff7f3f0' : '#ffffffdf';
    c.beginPath();
    c.roundRect(tx, ty - 29, 108, 44, 5);
    c.fill();
    c.restore();
    text(c, targetDisplayName(t), tx + 9, ty - 12, selected ? color : ink, 13);
    text(
      c,
      mode === 'risk'
        ? t.risk ? `场值 ${t.risk.value.toFixed(2)}` : ''
        : (t.radar?.range ?? 0).toFixed(1) + ' m',
      tx + 9,
      ty + 5,
      selected ? color : '#315a77',
      11,
    );
    hits.push(
      { id: t.id, x: tx, y: ty - 29, w: 108, h: 44 },
    );
  }
  return hits;
}
export function radarOverlay(c: CanvasRenderingContext2D, w: number, h: number, time: number, bounds?: WorldBounds, range=200, minimap=false) {
  const { map, scale } = groundMap(w, h, bounds),
    [cx, cy] = map(0, 0),
    r = range * scale,
    angle = time * 0.48 - Math.PI / 2;
  c.save();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = '#ffffff14';
  c.fill();
  for (let i = 0; i < 35; i++) {
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, r, angle - 0.8 + i * 0.023, angle - 0.8 + (i + 1) * 0.023);
    c.closePath();
    c.fillStyle = `rgba(0,168,151,${0.035 + i * 0.005})`;
    c.fill();
  }
  line(c, cx, cy, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, '#00a39570', 1.2);
  for (let ring = range/4; ring <= range; ring += range/4) {
    c.beginPath();
    c.arc(cx, cy, ring * scale, 0, Math.PI * 2);
    c.strokeStyle = ring === range ? '#228d9eaa' : '#43879d85';
    c.lineWidth = ring === range ? 1.2 : 0.7;
    c.setLineDash(ring === range ? [] : [2, 5]);
    c.stroke();
    c.setLineDash([]);
    text(c, ring + ' m', cx + 8, cy - ring * scale + 15, '#355e7a', 10);
  }
  for (let deg = 0; deg < 360; deg += 5) {
    const a = ((deg - 90) * Math.PI) / 180,
      len = deg % 30 ? 4 : 9;
    line(
      c,
      cx + Math.cos(a) * (r - len),
      cy + Math.sin(a) * (r - len),
      cx + Math.cos(a) * r,
      cy + Math.sin(a) * r,
      '#26647fa8',
      0.8,
    );
    if (!minimap && deg % 30 === 0)
      text(
        c,
        deg + '°',
        cx + Math.cos(a) * (r + 19),
        cy + Math.sin(a) * (r + 19) + 4,
        '#204b6e',
        11,
        'center',
      );
  }
  for (let deg = 0; deg < 180; deg += 30) {
    const a = (deg * Math.PI) / 180;
    line(
      c,
      cx - Math.cos(a) * r,
      cy - Math.sin(a) * r,
      cx + Math.cos(a) * r,
      cy + Math.sin(a) * r,
      '#5495b444',
      0.6,
    );
  }
  polygon(
    c,
    [
      [cx, cy - 10],
      [cx - 6, cy + 7],
      [cx, cy + 4],
      [cx + 6, cy + 7],
    ],
    teal,
  );
  text(c, 'EGO', cx, cy + 23, teal, 10, 'center');
  c.restore();
}

