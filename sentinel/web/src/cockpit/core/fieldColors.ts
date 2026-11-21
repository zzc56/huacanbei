// Normalized field strength and RGBA stops used by the SENTINEL ground views.
const stops = [
  [0, 147, 190, 196, 35], [0.2, 131, 198, 181, 85],
  [0.4, 166, 210, 180, 115], [0.58, 222, 211, 155, 140],
  [0.75, 211, 160, 128, 170], [1, 184, 96, 78, 195],
];

export function paintFieldCell(pixels: Uint8ClampedArray, offset: number, value: number) {
  const v = Math.max(0, Math.min(1, value));
  const hi = Math.max(1, stops.findIndex(stop => stop[0] >= v));
  const a = stops[hi - 1], b = stops[hi], ratio = (v - a[0]) / (b[0] - a[0]);
  for (let channel = 1; channel <= 4; channel++) {
    pixels[offset + channel - 1] = Math.round(a[channel] + (b[channel] - a[channel]) * ratio);
  }
}

export const fieldLegend = 'linear-gradient(to right, ' + stops.map(
  ([v, r, g, b]) => `rgb(${r} ${g} ${b}) ${v * 100}%`,
).join(', ') + ')';
