export interface GroundPoint {
  xM: number;
  yM: number;
}

export interface ScanPoint {
  rangeM: number;
  bearingDeg: number;
}

export interface SensorSample<T> {
  capturedAtMs: number;
  observations: T[];
}

type SensorView<T> = SensorSample<T> & { includedInFusion: boolean };

export interface VehicleObstacle extends GroundPoint {
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
  observations: {
    camera: SensorView<GroundPoint> | null;
    lidar: SensorView<ScanPoint> | null;
  };
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
