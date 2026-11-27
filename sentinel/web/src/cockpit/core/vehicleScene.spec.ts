import { describe, it, expect } from 'vitest';
import { vehicleScene } from './vehicleScene';
import { cameraTargetIcon, targetDisplayName } from './targetLabels';
import { paintFieldCell } from './fieldColors';
import type { VehicleResult } from '../../../../sentinel-backend/src/vehicle/contracts';

const time=5000, origin='http://127.0.0.1:3001';
function observation(): VehicleResult {
  return {
    evaluatedAtMs:time, motion:{action:'slow',speedLimitMps:.1,reason:'forward_risk'},
    observations:{
      camera:{capturedAtMs:time,sequence:3,includedInFusion:true,observations:[{xM:2,yM:1,trackId:'V01'}]},
      lidar:{capturedAtMs:time,includedInFusion:true,observations:[{rangeM:.5,bearingDeg:0}]},
    },
    obstacles:[{xM:0,yM:.5,source:'both',cameraIndex:0,lidarIndex:0}],
    field:null, corridorRisk:null, closestForwardM:.5, cameraCount:1,lidarCount:1,
    capture:{vision:{sequence:3,captured_utc:new Date(time).toISOString(),width:400,height:200,
      imageUrl:'/api/live/camera/3.jpg',detections:[{track_id:'V01',label:'person',score:.95,x:80,y:40,width:40,height:100}]},
      status:{ageMs:0,state:'streaming',message:'',sequence:3,detector:'local',timing:{}}},
  };
}
describe('vehicle cockpit',()=>{
  it('keeps independent ball numbers across frames and uses the ball label for a fused target', () => {
    const data = observation();
    const image = data.capture!.vision!;
    const firstBall = { ...image.detections[0]!, label: 'sports ball' };
    const secondBall = { ...firstBall, track_id: 'V23', x: 180 };
    const person = { ...firstBall, label: 'person', track_id: 'V24' };
    const ballNumbers = new Map<string, number>();
    image.detections = [firstBall, secondBall, person];
    let scene = vehicleScene(data, origin, undefined, ballNumbers);
    expect(scene.targets.map(target => target.id)).toEqual(['BALL-1', 'BALL-2', 'V-V24']);
    const fusedBall = scene.targets[0]!;
    expect(fusedBall).toMatchObject({vehicleSource:'both', radar:{range:.5}, camera:{trackId:'V01'}});
    expect(targetDisplayName(fusedBall, {showVisualNumber:false})).toBe('球 1');
    expect(cameraTargetIcon(fusedBall)).toBe('ball');
    image.detections = [person, secondBall, firstBall];
    scene = vehicleScene(data, origin, undefined, ballNumbers);
    expect(scene.targets.map(target => target.id)).toEqual(['BALL-1', 'V-V24', 'BALL-2']);
    expect(scene.targets[2]?.camera?.trackId).toBe('V23');
  });
  it('retains the exact camera frame during a vehicle update with missing data',()=>{
    const previous=observation().capture;
    const waiting=vehicleScene(null,origin,previous);
    expect(waiting.cameraFrame?.sequence).toBe(3);
    expect(waiting.targets[0]?.camera?.sequence).toBe(3);
    expect(waiting.riskField).toBeUndefined();
  });
  it('links a calibrated target to the exact same image, track, radar return and field location',()=>{
    const data=observation();
    const scene=vehicleScene(data,origin);
    expect(scene.targets).toHaveLength(1);
    expect(scene.targets[0]).toMatchObject({vehicleSource:'both',radar:{range:.5},fusion:{y:.5},camera:{class:'person',confidence:.95}});
    expect(scene.cameraFrame?.imageUrl).toBe(origin+'/api/live/camera/3.jpg?at=5000');
    data.observations.camera!.sequence=4;
    expect(vehicleScene(data,origin).targets).toHaveLength(2);
    data.observations.camera!.sequence=3;
    data.observations.camera!.capturedAtMs--;
    expect(vehicleScene(data,origin).targets[0].camera).toBeUndefined();
  });
  it('gives common low-speed field strengths distinguishable colors on a fixed scale',()=>{
    function color(v:number) {const p=new Uint8ClampedArray(4);paintFieldCell(p,0,v,true);return [...p];}
    expect(color(0)).not.toEqual(color(.03));
    expect(color(.30)[0]).toBeLessThan(color(.38)[0]-40);
    expect(color(1)[0]).toBeGreaterThan(color(1)[1]+100);
    expect(color(.3)[3]).toBe(255);
  });
  it('keeps live boxes separate from older ground observations even when identifiers coincide',()=>{
    const data=observation();
    data.observations.camera!.sequence=2;
    const scene=vehicleScene(data,origin);
    expect(scene.cameraFrame?.sequence).toBe(3);
    expect(scene.targets.filter(t=>t.fusion)).toHaveLength(1);
    expect(scene.targets.find(t=>t.fusion)?.camera).toBeUndefined();
    const preview=scene.targets.find(t=>t.camera);
    expect(preview?.camera?.trackId).toBe('V01');
    expect(preview?.fusion).toBeUndefined();
    expect(preview?.radar).toBeUndefined();
  });
});
