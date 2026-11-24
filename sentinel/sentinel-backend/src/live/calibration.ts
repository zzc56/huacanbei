type Point = { x: number; y: number };
type ControlPoint = { u: number; v: number; x: number; y: number };
export type CalibrationSettings = {
  width: number;
  height: number;
  cameraOffsetMs: number;
  alignmentWindowMs: number;
  points: ControlPoint[];
};
export type LiveCalibration = {
  settings: CalibrationSettings;
  matrix: number[];
  boundary: Point[];
  rmsErrorM: number;
  maxErrorM: number;
};

const within = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  function half(order: Point[]) {
    const result: Point[] = [];
    for (const point of order) {
      while (result.length >= 2 && cross(result[result.length - 2]!, result[result.length - 1]!, point) <= 0) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  }
  return [...half(sorted), ...half(sorted.reverse())];
}

function area(points: Point[]) {
  return Math.abs(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length]!;
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / 2;
}

function solve(rows: number[][], values: number[]) {
  const dimension = 8;
  const system = Array.from({ length: dimension }, () => Array<number>(dimension + 1).fill(0));
  rows.forEach((row, k) => {
    for (let i = 0; i < dimension; i++) {
      for (let j = 0; j < dimension; j++) system[i]![j]! += row[i]! * row[j]!;
      system[i]![dimension]! += row[i]! * values[k]!;
    }
  });
  for (let i = 0; i < dimension; i++) {
    let pivot = i;
    for (let j = i + 1; j < dimension; j++) if (Math.abs(system[j]![i]!) > Math.abs(system[pivot]![i]!)) pivot = j;
    [system[i], system[pivot]] = [system[pivot]!, system[i]!];
    const row = system[i]!;
    const divisor = row[i]!;
    if (Math.abs(divisor) < 1e-9) return;
    for (let j = i; j <= dimension; j++) row[j]! /= divisor;
    for (let k = 0; k < dimension; k++) {
      if (k === i) continue;
      const coefficient = system[k]![i]!;
      for (let j = i; j <= dimension; j++) system[k]![j]! -= coefficient * row[j]!;
    }
  }
  return [...system.map((row) => row[dimension]!), 1];
}

function denominator(matrix: number[], u: number, v: number) {
  return matrix[6]! * (2 * u - 1) + matrix[7]! * (2 * v - 1) + 1;
}

function project(matrix: number[], u: number, v: number): Point {
  const x = 2 * u - 1, y = 2 * v - 1;
  const d = denominator(matrix, u, v);
  return { x: 100 * (matrix[0]! * x + matrix[1]! * y + matrix[2]!) / d,
    y: 100 * (matrix[3]! * x + matrix[4]! * y + matrix[5]!) / d };
}

export function prepareCalibration(input: unknown): LiveCalibration {
  const settings = (input ?? {}) as Partial<CalibrationSettings>;
  const { width, height, cameraOffsetMs, alignmentWindowMs, points } = settings;
  if (!within(width, 1, 8192) || !Number.isInteger(width) || !within(height, 1, 8192) || !Number.isInteger(height) ||
    !within(cameraOffsetMs, -5000, 5000) || !within(alignmentWindowMs, 20, 500) ||
    !Array.isArray(points) || points.length < 4 || points.length > 12) {
    throw Error('请填写有效画面尺寸、4–12 组控制点、±5000 ms 内的时间偏移和 20–500 ms 对齐容差');
  }
  const rows: number[][] = [], values: number[] = [], clean: ControlPoint[] = [];
  for (const point of points) {
    if (!point || !within(point.u, 0, 1) || !within(point.v, 0, 1) || !within(point.x, -2000, 2000) || !within(point.y, -2000, 2000)) {
      throw Error('控制点必须位于画面内，雷达坐标填写米制 X、Y');
    }
    const { u, v, x, y } = point;
    const X = 2 * u - 1, Y = 2 * v - 1, a = x / 100, b = y / 100;
    rows.push([X, Y, 1, 0, 0, 0, -a * X, -a * Y], [0, 0, 0, X, Y, 1, -b * X, -b * Y]);
    values.push(a, b);
    clean.push({ u, v, x, y });
  }
  const boundary = convexHull(clean.map(({ u, v }) => ({ x: u, y: v })));
  const matrix = solve(rows, values);
  if (!matrix || area(boundary) < 0.002 || area(convexHull(clean)) < 1) {
    throw Error('控制点分布过窄，请在画面和雷达的共同范围内分散取点');
  }
  const divisors = boundary.map(point => denominator(matrix, point.x, point.y));
  if (!divisors.every(value => value > .005) && !divisors.every(value => value < -.005)) {
    throw Error('投影在标定区域内不稳定，请核对控制点对应关系');
  }
  const errors = clean.map(point => {
    const projected = project(matrix, point.u, point.v);
    return Math.hypot(projected.x - point.x, projected.y - point.y);
  });
  const maxErrorM = Math.max(...errors);
  if (!Number.isFinite(maxErrorM) || maxErrorM > 3) throw Error('控制点误差超过 3 m，请核对画面标记与雷达坐标');
  return { settings: { width, height, cameraOffsetMs, alignmentWindowMs, points: clean }, matrix, boundary,
    rmsErrorM: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length), maxErrorM };
}

export function calibratedPoint(calibration: LiveCalibration, u: number, v: number): Point | undefined {
  if (!within(u, 0, 1) || !within(v, 0, 1)) return;
  const { boundary, matrix } = calibration;
  if (boundary.some((a, i) => cross(a, boundary[(i + 1) % boundary.length]!, { x: u, y: v }) < -1e-8)) return;
  return project(matrix, u, v);
}
