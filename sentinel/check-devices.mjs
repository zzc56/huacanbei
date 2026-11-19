import net from 'node:net';
import os from 'node:os';
import {loadSettings} from './settings.mjs';

const {config,python,pythonReady}=loadSettings();
const addresses=Object.values(os.networkInterfaces()).flat().filter(Boolean).map(i=>i.address);
console.log(`Python: ${python} (${pythonReady?'已找到':'不存在'})`);
async function check(name,host,port,localAddress){
  if(!addresses.includes(localAddress)){
    console.log(`${name}: 本机缺少网卡地址 ${localAddress}，请检查接线、驱动和 IPv4 配置`);
    return false;
  }
  return new Promise(resolve=>{
    const socket=net.createConnection({host,port,localAddress});
    let done=false;
    const finish=(ok,message)=>{
      if(done)return;
      done=true;
      console.log(`${name}: ${message}`);
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.once('connect',()=>finish(true,`${host}:${port} TCP 可达（尚需在实时系统确认数据帧）`));
    socket.once('timeout',()=>finish(false,`${host}:${port} 连接超时`));
    socket.once('error',e=>finish(false,e.code));
  });
}
const radar=await check('雷达',config.radar.host,config.radar.port,config.radar.localAddress);
const url=new URL(config.camera.rtspUrl);
const camera=!config.camera.enabled||await check('摄像头',url.hostname,Number(url.port)||554,config.camera.localAddress);
process.exitCode=radar&&camera&&(!config.camera.enabled||pythonReady)?0:1;
