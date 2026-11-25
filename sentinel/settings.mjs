import {readFileSync,existsSync} from 'node:fs';
import {delimiter,dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=dirname(fileURLToPath(import.meta.url));
export function loadSettings(){
  const configPath=resolve(root,'config/devices.json');
  if(!existsSync(configPath))throw Error('请将 config/devices.example.json 复制为 config/devices.json 并填写设备参数');
  const config=JSON.parse(readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
  const r=config.radar,c=config.camera;
  if(!r||!c)throw Error('config/devices.json 缺少 radar 或 camera 配置');
  const usb=c.deviceIndex!==undefined && c.deviceIndex!==null;
  if(usb&&(!Number.isInteger(c.deviceIndex)||c.deviceIndex<0))throw Error('USB 摄像头编号必须为非负整数');
  for(const ip of [r.host,r.localAddress,...(usb?[]:[c.localAddress])]){
    if(typeof ip!=='string'||!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)||ip.split('.').some(n=>Number(n)>255))
      throw Error('设备和网卡地址必须是有效 IPv4 地址');
  }
  if(!Number.isInteger(r.port)||r.port<1||r.port>65535)throw Error('雷达端口无效');
  if(c.enabled&&!usb&&!['rtsp:','rtsps:'].includes(new URL(c.rtspUrl).protocol))throw Error('摄像头地址必须使用 RTSP');
  const path=value=>isAbsolute(value)?value:resolve(root,value);
  const python=path(c.pythonPath||'.venv/Scripts/python.exe'),model=path(c.modelPath||'models/yolov8n.pt');
  const pythonPackages=c.pythonPackagesPath ? path(c.pythonPackagesPath) : '';
  return {config,python,model,pythonReady:existsSync(python),environment:{
    RADAR_HOST:r.host,RADAR_PORT:String(r.port),RADAR_BIND:r.localAddress,
    CAMERA_RTSP_URL:c.enabled&&!usb&&existsSync(python)?c.rtspUrl:'',
    CAMERA_DEVICE_INDEX:c.enabled&&usb&&existsSync(python)?String(c.deviceIndex):'',
    CAMERA_PYTHON:python,CAMERA_MODEL_PATH:model,CAMERA_FPS:String(Math.max(1,Math.min(15,Number(c.fps)||10))),
    CAMERA_IMGSZ:String(Math.max(320,Math.min(640,Math.round(Number(c.inferenceSize)||416)))),
    CAMERA_ONNX_PATH:c.onnxModelPath ? path(c.onnxModelPath) : '',
    CAMERA_BASKETBALL_ONNX_PATH:c.basketballOnnxPath ? path(c.basketballOnnxPath) : '',
    ...(c.lowLatency === true ? {OPENCV_FFMPEG_CAPTURE_OPTIONS:'rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;0|reorder_queue_size;0|probesize;65536|analyzeduration;800000'} : {}),
    ...(pythonPackages ? {PYTHONPATH:[pythonPackages,process.env.PYTHONPATH].filter(Boolean).join(delimiter)} : {}),
    CAMERA_GROUND_CALIBRATION:c.groundCalibration ? JSON.stringify(c.groundCalibration) : '',
    SENTINEL_DEVICE_CONFIG_PATH:configPath,
  }};
}
