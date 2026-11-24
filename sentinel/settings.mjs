import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=dirname(fileURLToPath(import.meta.url));
export function loadSettings({allowUnconfigured=false}={}){
  const configPath=resolve(root,'config/devices.json');
  const configured=existsSync(configPath);
  if(!configured&&!allowUnconfigured)throw Error('请将 config/devices.example.json 复制为 config/devices.json 并填写设备参数');
  const config=JSON.parse(readFileSync(configured?configPath:resolve(root,'config/devices.example.json'),'utf8').replace(/^\uFEFF/,''));
  const r=config.radar,c=config.camera;
  if(!r||!c)throw Error('config/devices.json 缺少 radar 或 camera 配置');
  if(!configured){
    r.host='';
    r.localAddress='';
  }
  const radarUnset=allowUnconfigured&&r.host==='';
  for(const ip of [...(radarUnset?[]:[r.host]),c.localAddress,...(r.localAddress!=null&&r.localAddress!==''?[r.localAddress]:[])]){
    if(typeof ip!=='string'||!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)||ip.split('.').some(n=>Number(n)>255))
      throw Error('设备和网卡地址必须是有效 IPv4 地址');
  }
  if(!Number.isInteger(r.port)||r.port<1||r.port>65535)throw Error('雷达端口无效');
  if(c.enabled&&!['rtsp:','rtsps:'].includes(new URL(c.rtspUrl).protocol))throw Error('摄像头地址必须使用 RTSP');
  const path=value=>isAbsolute(value)?value:resolve(root,value);
  const python=path(c.pythonPath||'.venv/Scripts/python.exe'),model=path(c.modelPath||'models/yolov8n.pt');
  return {config,python,model,pythonReady:existsSync(python),environment:{
    SENTINEL_DEVICES_FILE:configPath,RADAR_HOST:r.host,RADAR_PORT:String(r.port),RADAR_BIND:r.localAddress??'',
    CAMERA_RTSP_URL:c.enabled&&existsSync(python)?c.rtspUrl:'',
    CAMERA_PYTHON:python,CAMERA_MODEL_PATH:model,CAMERA_FPS:String(Math.max(1,Math.min(15,Number(c.fps)||10))),
  }};
}
