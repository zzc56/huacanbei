/** Marching squares：边上进行线性插值，鞍点用单元中心值消歧。 */
export function contourPath(
  values: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Path2D {
  const path = new Path2D();
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const a=values[y*width+x],b=values[y*width+x+1],
        c=values[(y+1)*width+x+1],d=values[(y+1)*width+x];
      // Most live cells are flat. Avoid allocating geometry for them at every level.
      if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||!Number.isFinite(d) ||
        (a>=threshold)===(b>=threshold) && (a>=threshold)===(c>=threshold) && (a>=threshold)===(d>=threshold))continue;
      const v = [a,b,c,d];
      const points = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      // Unknown / masked nodes cannot form an isoline or an invented zero-risk border.
      if (v.some(value => !Number.isFinite(value))) continue;
      const cuts: number[][] = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if (v[edge] >= threshold === v[next] >= threshold) continue;
        const t = (threshold - v[edge]) / (v[next] - v[edge]);
        cuts.push([
          points[edge][0] + (points[next][0] - points[edge][0]) * t,
          points[edge][1] + (points[next][1] - points[edge][1]) * t,
        ]);
      }
      if (cuts.length === 4 && v.reduce((a, b) => a + b) / 4 >= threshold) cuts.push(cuts.shift()!);
      for (let i = 0; i < cuts.length; i += 2) {
        path.moveTo(cuts[i][0], cuts[i][1]);
        path.lineTo(cuts[i + 1][0], cuts[i + 1][1]);
      }
    }
  return path;
}
