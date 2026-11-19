import { computeRiskField, targetContribution } from './risk';
import type { Grid, RiskParams, Target } from '../types';
self.onmessage = (
  event: MessageEvent<{ targets: Target[]; grid: Grid; params: RiskParams; selectedId: string }>,
) => {
  const { targets, grid, params, selectedId } = event.data;
  const values = computeRiskField(targets, grid, params);
  const contribution = new Float32Array(values.length),
    selected = targets.find((t) => t.id === selectedId);
  if (selected)
    for (let row = 0; row < grid.height; row++)
      for (let col = 0; col < grid.width; col++) {
        contribution[row * grid.width + col] = targetContribution(
          selected,
          grid.xMin + (col / (grid.width - 1)) * (grid.xMax - grid.xMin),
          grid.yMax - (row / (grid.height - 1)) * (grid.yMax - grid.yMin),
          params,
        );
      }
  self.postMessage(
    { values, contribution, selectedId },
    { transfer: [values.buffer, contribution.buffer] },
  );
};
