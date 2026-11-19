/** Wire contract served by the recording backend; null denotes unavailable measurements. */
export interface RecordedActor {
  id: string; source: 'radar' | 'vision'; kind: string;
  x: number; y: number; vx: number|null; vy: number|null; velocity_known: boolean;
  confidence: number|null; source_sequence: number;
  original_observed_utc: string; observed_utc: string;
}
export interface RecordedSnapshot {
  host_utc: string; observation_utc: string|null; valid_until_utc: string|null;
  vision_sequence: number|null; status: string; field_available: boolean;
  field_scope: 'unavailable'|'calibrated_joint'|'radar_wide_joint_local'|'radar_only';
  calibration_valid: boolean; calibration: { homography:number[]; image_width:number; image_height:number }|null;
  radar_objects: RecordedActor[]; pedestrians: RecordedActor[];
  grid_width:number; grid_height:number; x_axis:number[]|null; y_axis:number[]|null;
  display_field:(number|null)[]|null; raw_field:(number|null)[]|null;
  valid_field_mask:boolean[]|null; calibrated_area_mask:boolean[]|null;
  model_version:string; message:string;
}
export interface RecordedDetection {
  sequence:string; captured_utc:string; x:string; y:string; width:string; height:string;
  score:string; class:string; label:string;
}
export interface RecordedVision {
  sequence:string; captured_utc:string; width:string; height:string; video_pts_ms:string;
  imageUrl:string; videoTimeSeconds:number; detections:RecordedDetection[];
  association?: Pick<RecordedSnapshot,'vision_sequence'|'observation_utc'|'valid_until_utc'|'calibration_valid'|'calibration'|'pedestrians'> | null;
  vehicleLinks?: {detectionIndex:number;visualTrackId:string;radarId?:string;status:'unmatched'|'tentative'|'held';reason:string;
    score?:number;samples?:number;correlation?:number;medianDistance?:number;radarAgeMs?:number;method:'trajectory-geometry-v1'}[];
}
export interface RecordedRadar {
  target_seq:string; recv_seq:string; host_received_utc:string; track_id:string;
  range:string; angle:string; x_lateral:string; y_longitudinal:string;
  vx_lateral:string; vy_longitudinal:string; rcs:string;
}
export interface RecordedEnvelope {
  type:'recorded_frame'; timestamp:number; snapshot:RecordedSnapshot|null;
  vision:RecordedVision|null; radar:RecordedRadar[];
  replay:{positionMs:number;durationMs:number;ended:boolean};
  context:{source:'recording';videoUrl:string|null;northCalibrated:boolean;radarRange:number;
    dispatchHz:number;counts:{video:number;detections:number;radar:number;fusion:number};
    bounds:{xMin:number;xMax:number;yMin:number;yMax:number}};
}
export interface BackendFrame {
  timestamp:number; fps:number;
  targets:{id:string;radar?:{range:number;azimuth:number;radialVelocity:number};
    camera?:{bbox:[number,number,number,number];class:string;confidence:number};
    fusion?:{x:number;y:number;speed:number;heading:number;azimuth:number;radialVelocity:number;tangentialVelocity:number};
    risk?:{value:number;level:'low'|'mid'|'high'}}[];
  riskField?:{gridWidth:number;gridHeight:number;resolution:number;xMin?:number;yMin?:number;
    highRiskZones:{row:number;startColumn:number;values:number[]}[]};
}
