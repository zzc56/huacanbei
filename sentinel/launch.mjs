import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream,existsSync} from 'node:fs';
import {join} from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {root,loadSettings} from './settings.mjs';

const mode=process.argv[2]??'live',children=[];
if(!['live','recording','vehicle','--check'].includes(mode))throw Error('使用 live、recording 或 vehicle 模式');
const settings=(mode==='live'||mode==='--check'||mode==='vehicle'&&existsSync(join(root,'config/devices.json')))?loadSettings():null;
for(const file of ['web/dist/index.html','sentinel-backend/dist/src/main.js','sentinel-backend/node_modules/fastify/package.json'])
  if(!existsSync(join(root,file)))throw Error('迁移包缺少文件：'+file);
if(mode!=='vehicle'&&settings?.config.camera.enabled&&!existsSync(settings.model))
  throw Error('找不到摄像头检测模型：'+settings.model);
if(mode==='--check'){
  console.log(JSON.stringify({root,node:process.version,pythonReady:settings.pythonReady,python:settings.python,
    model:settings.model,radar:settings.config.radar.host,camera:settings.config.camera.deviceIndex ?? new URL(settings.config.camera.rtspUrl).hostname,
    sourceFilesReady:true},null,2));
}else{
  mkdirSync(join(root,'logs'),{recursive:true});
  async function available(port){
    const server=net.createServer();
    await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error(`${port} 端口已被占用。先关闭旧的实时/回放启动窗口，再启动本包。`)));server.listen(port,'127.0.0.1',resolve);});
    await new Promise(resolve=>server.close(resolve));
  }
  function launch(folder,file,name,environment={}){
    const output=createWriteStream(join(root,'logs',name+'.log'),{flags:'a'});
    const child=spawn(process.execPath,[file],{cwd:join(root,folder),windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{...process.env,...environment,SOURCE_MODE:mode,HOST:'127.0.0.1',PORT:'3001',RECORDING_DIR:join(root,'数据保存')}});
    children.push(child);child.stdout.pipe(output);child.stderr.pipe(output);
    child.on('error',()=>console.error(name+' 无法启动，请查看 logs 目录'));
  }
  async function wait(url,valid){
    for(let i=0;i<60;i++){
      try{const response=await fetch(url,{signal:AbortSignal.timeout(1200)});if(response.ok&&valid(await response.json()))return;}catch{}
      await delay(250);
    }
    throw Error('服务启动失败，请查看 logs：'+url);
  }
  function close(){for(const child of children)child.kill();}
  process.on('SIGINT',()=>{close();process.exit(0);});
  process.on('SIGTERM',()=>{close();process.exit(0);});
  process.on('exit',close);
  try{
    await available(3001);await available(4173);
    if(settings?.config.camera.enabled&&!settings.pythonReady)
      console.log('摄像头 Python 环境尚未配置，请安装摄像头依赖并在 config/devices.json 配置 camera.pythonPath。');
    launch('sentinel-backend','dist/src/main.js',mode+'-backend',settings?.environment);
    await wait('http://127.0.0.1:3001/api/health',data=>data.source===mode);
    launch('web','scripts/serve-dist.mjs',mode+'-frontend');
    await wait('http://127.0.0.1:4173/real-data-version.json',()=>true);
    const url='http://127.0.0.1:4173/'+(mode==='vehicle'?'#/vehicle':'');
    const title={live:'实时硬件',recording:'历史实测回放',vehicle:'车路协同'}[mode];
    console.log(`已启动${title}：${url}\n保留此窗口，Ctrl+C 停止。`);
    if(process.env.SENTINEL_NO_OPEN!=='1')spawn('cmd.exe',['/d','/s','/c',`start "" "${url}"`],
      {windowsHide:true,stdio:'ignore'});
    setInterval(()=>{},60000);
  }catch(error){console.error(error.message);close();process.exitCode=1;}
}
