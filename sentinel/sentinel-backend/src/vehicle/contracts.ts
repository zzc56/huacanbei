export interface GroundPoint {
  xM: number;
  yM: number;
}

export interface StationaryPose extends GroundPoint {
  headingDeg: number;
  stationaryId: string;
}

export type StationaryFusionState = 'waiting_for_pose' | 'waiting_for_radar' | 'waiting_for_camera' | 'waiting_for_sync' | 'aligned';

export interface GroundVelocity {
  xMps: number;
  yMps: number;
}

export interface CameraPoint extends GroundPoint { trackId?: string; velocity?: GroundVelocity }

export interface ScanPoint {
  rangeM: number;
  bearingDeg: number;
  trackId?: string;
  velocity?: GroundVelocity;
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
  velocity?: GroundVelocity;
}

export interface RightTurnCorridor {
  forwardM: number;
  rightM: number;
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
  corner?: RightTurnCorridor;
}

export interface VehicleResult {
  observations: {
    camera: (SensorView<CameraPoint> & { sequence?: number }) | null;
    lidar: SensorView<ScanPoint> | null;
  };
  capture?: ReturnType<import('../live/camera.js').CameraFrameStore['snapshot']>;
  stationaryFusion?: StationaryFusionState;
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
    reason: 'near_obstacle' | 'forward_risk' | 'blind_corner' | 'camera_unavailable' | 'path_clear' | 'pose_or_lidar_unavailable';
  };
}

export const radarTrialSettings = { speedMmps: 400, stopDistanceM: 0.40 } as const;
export type DriveDirection = 'forward' | 'stop';
export interface StockTelemetry {
  port: string;
  status: 'idle' | 'connecting' | 'online' | 'stale' | 'error' | 'busy';
  sample: { wheelAMps: number; wheelBMps: number; batteryPercent: number | null; receivedAtMs: number } | null;
  readyForRadarTrial?: boolean;
  stationaryId?: string;
  lidar?: StockLidarPreview;
}

export interface StockLidarPreview {
  status: 'waiting' | 'offline' | 'stale' | 'online';
  sample: StockLidarSample | null;
}

export interface StockLidarSample {
  sequence: number;
  capturedTickMs: number;
  receivedAtMs: number;
  nearest: ScanPoint | null;
}

export type RadarStopMeasurement =
  | { status: 'measuring'; beforeM: number; wheelSpeedMps: number }
  | { status: 'complete'; beforeM: number; afterM: number; reductionM: number; wheelSpeedMps: number }
  | { status: 'unavailable'; message: string };

export interface BenchDriveStatus {
  phase: 'arming' | 'ready' | 'stopped';
  message: string;
  direction: DriveDirection;
  speedLimitMps: number;
  targetSpeedMps: number;
  radarTrial: {
    state: 'clear' | 'obstacle' | 'release' | 'unavailable';
    stopDistanceM: number;
    measurement?: RadarStopMeasurement;
  };
}

export interface DriveSnapshot {
  telemetry?: StockTelemetry;
  bench?: BenchDriveStatus;
  radarRisk?: VehicleResult;
}
