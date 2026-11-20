export interface VehicleObstacle {
  xM: number;
  yM: number;
  source: 'camera' | 'lidar' | 'both';
}

export interface VehicleField {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
  resolution: number;
  values: number[];
  corridorHalfWidthM: number;
  lookAheadM: number;
}

export interface VehicleResult {
  obstacles: VehicleObstacle[];
  field: VehicleField | null;
  corridorRisk: number | null;
  closestForwardM: number | null;
  cameraCount: number | null;
  lidarCount: number | null;
  motion: {
    action: 'cruise' | 'slow' | 'stop';
    speedLimitMps: number;
    reason: 'near_obstacle' | 'forward_risk' | 'camera_unavailable' | 'path_clear' | 'pose_or_lidar_unavailable';
  };
}

export interface VehicleDemoResult extends VehicleResult {
  step: number;
  lastStep: number;
  tickMs: number;
  stages: number[];
}
