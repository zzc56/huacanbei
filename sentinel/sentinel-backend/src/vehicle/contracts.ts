export interface GroundPoint {
  xM: number;
  yM: number;
}

export interface CameraPoint extends GroundPoint { trackId?: string }

export interface ScanPoint {
  rangeM: number;
  bearingDeg: number;
  trackId?: string;
}

export interface SensorSample<T> {
  capturedAtMs: number;
  observations: T[];
}

type SensorView<T> = SensorSample<T> & { includedInFusion: boolean };

export interface VehicleObstacle extends GroundPoint {
  source: 'camera' | 'lidar' | 'both';
  cameraIndex?: number;
  lidarIndex?: number;
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
    camera: (SensorView<CameraPoint> & { sequence?: number }) | null;
    lidar: SensorView<ScanPoint> | null;
  };
  capture?: ReturnType<import('../live/camera.js').CameraFrameStore['snapshot']>;
  evaluatedAtMs: number;
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

export type DriveDirection = 'forward' | 'reverse' | 'stop';
export interface DriveSnapshot {
  frame: VehicleResult;
  preview?: VehicleResult['capture'];
  direction: DriveDirection;
  requestedMps: number;
  limitMps: number;
  speedMps: number;
  travelM: number;
  timedOut: boolean;
}
