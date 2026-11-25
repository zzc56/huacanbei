// Normalized field strength and RGBA stops used by the SENTINEL ground views.
const stops = [
  [0, 147, 190, 196, 35], [0.2, 131, 198, 181, 85],
  [0.4, 166, 210, 180, 115], [0.58, 222, 211, 155, 140],
  [0.75, 211, 160, 128, 170], [1, 184, 96, 78, 195],
];

// A fixed 0..1 scale for the indoor vehicle. Small, low-speed fields need more
// contrast in the lower third of the range when projected on the light cockpit.
const vehicleStops = [
  [0, 235, 246, 251, 255], [0.03, 196, 230, 245, 255], [0.12, 96, 191, 230, 255],
  [0.24, 24, 170, 188, 255], [0.32, 39, 177, 146, 255], [0.40, 127, 194, 100, 255],
  [0.60, 244, 202, 91, 255], [0.75, 242, 141, 60, 255], [1, 196, 55, 46, 255],
];

export function paintFieldCell(pixels: Uint8ClampedArray, offset: number, value: number, vehicle = false) {
  const v = Math.max(0, Math.min(1, value));
  const palette = vehicle ? vehicleStops : stops;
  const hi = Math.max(1, palette.findIndex(stop => stop[0] >= v));
  const a = palette[hi - 1], b = palette[hi], ratio = (v - a[0]) / (b[0] - a[0]);
  for (let channel = 1; channel <= 4; channel++) {
    pixels[offset + channel - 1] = Math.round(a[channel] + (b[channel] - a[channel]) * ratio);
  }
}

export const vehicleFieldLegend = 'linear-gradient(to right, ' + vehicleStops.map(
  ([v, r, g, b]) => `rgb(${r} ${g} ${b}) ${v * 100}%`,
).join(', ') + ')';
