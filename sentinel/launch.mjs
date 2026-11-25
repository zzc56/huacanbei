import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {root,loadSettings} from './settings.mjs';
import {authOrigin} from './web/scripts/auth-origin.mjs';

const mode=process.argv[2]??'live',children=[];
if(!['live','recording','--check'].includes(mode))throw Error('使用 live 或 recording 模式');
const settings=loadSettings({allowUnconfigured:true});
for(const file of ['web/dist/index.html','sentinel-backend/dist/src/main.js','sentinel-backend/node_modules/fastify/package.json'])
  if(!existsSync(join(root,file)))throw Error(`缺少 ${file}。请先按仓库 README.md 的「安装和构建」准备项目。`);
const modelReady=existsSync(settings.model);
if(mode==='--check'){
  console.log(JSON.stringify({root,node:process.version,pythonReady:settings.pythonReady,python:settings.python,
    model:settings.model,modelReady,radar:settings.config.radar.host||'未配置',
    camera:settings.config.camera.enabled?new URL(settings.config.camera.rtspUrl).hostname:'未启用',
    sourceFilesReady:true},null,2));
}else{
  const frontend='http://127.0.0.1:4173';
  const backend='http://127.0.0.1:3001';
  const workspace=createHash('sha256').update(root.toLowerCase())
    .update(authOrigin===backend?'':'\0'+authOrigin).digest('hex');
  const page=frontend+(mode==='recording'?'/#/history':'/');
  let stopping=false;
  async function available(port){
    const server=net.createServer();
    await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error(`${port} 端口已被占用。先关闭旧的实时/回放启动窗口，再启动本包。`)));server.listen(port,'127.0.0.1',resolve);});
    await new Promise(resolve=>server.close(resolve));
  }
  function launch(folder,file,name,environment={}){
    const output=createWriteStream(join(root,'logs',name+'.log'),{flags:'a'});
    const [nodeMajor,nodeMinor]=process.versions.node.split('.').map(Number);
    const args=folder==='sentinel-backend'&&nodeMajor===22&&nodeMinor<13?['--experimental-sqlite',file]:[file];
    const child=spawn(process.execPath,args,{cwd:join(root,folder),windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{...process.env,...environment,SOURCE_MODE:'live',HOST:'127.0.0.1',PORT:'3001'}});
    children.push(child);
    child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
    child.on('error',()=>console.error(name+' 无法启动，请查看 logs 目录'));
    output.on('error',error=>console.error(name+' 日志写入失败：'+error.message));
    child.on('close',()=>{
      output.end();
      if(!stopping){
        console.error(name+' 已退出，请查看 logs 目录');
        close();process.exitCode=1;
      }
    });
  }
  async function wait(url,valid){
    for(let i=0;i<60&&!stopping;i++){
      try{const response=await fetch(url,{signal:AbortSignal.timeout(1200)});if(response.ok&&valid(await response.json()))return;}catch{}
      await delay(250);
    }
    throw Error('服务启动失败，请查看 logs：'+url);
  }
  async function alreadyRunning(){
    try{
      const [web,api]=await Promise.all([
        fetch(frontend+'/real-data-version.json',{signal:AbortSignal.timeout(1000)}),
        fetch(backend+'/api/health',{signal:AbortSignal.timeout(1000)}),
      ]);
      const sameWorkspace=web.ok&&web.headers.get('x-sentinel-workspace')===workspace;
      await web.body?.cancel();
      const status=await api.json();
      return sameWorkspace&&api.ok&&status.source==='live';
    }catch{return false;}
  }
  function openPage(){
    if(process.env.SENTINEL_NO_OPEN!=='1')spawn('cmd.exe',['/d','/s','/c','start "" "'+page+'"'],
      {windowsHide:true,stdio:'ignore'}).on('error',()=>console.log('请手动打开 '+page));
  }
  function close(){stopping=true;for(const child of children)child.kill();}
  process.on('SIGINT',()=>{close();process.exit(0);});
  process.on('SIGTERM',()=>{close();process.exit(0);});
  process.on('exit',close);
  try{
    if(await alreadyRunning()){
      console.log('已打开现有 Sentinel 服务：'+page);
    }else{
      await available(3001);await available(4173);
      mkdirSync(join(root,'logs'),{recursive:true});
      if(settings.config.camera.enabled&&!settings.pythonReady)
        console.log('摄像头 Python 环境尚未配置。请安装摄像头依赖并在 config/devices.json 配置 camera.pythonPath。');
      if(settings.config.camera.enabled&&settings.pythonReady&&!modelReady)
        console.log('找不到检测模型，本次摄像头只提供画面：'+settings.model);
      launch('sentinel-backend','dist/src/main.js','live-backend',settings.environment);
      await wait(backend+'/api/health',data=>data.source==='live');
      launch('web','scripts/serve-dist.mjs','live-frontend',{
        SENTINEL_AUTH_ORIGIN:authOrigin,SENTINEL_LIVE_ORIGIN:backend,SENTINEL_WORKSPACE:workspace,
      });
      await wait(frontend+'/real-data-version.json',()=>true);
      console.log(`已启动 Sentinel：${page}\n保留此窗口，Ctrl+C 停止。`);
    }
    openPage();
  }catch(error){console.error(error.message);close();process.exitCode=1;}
}
