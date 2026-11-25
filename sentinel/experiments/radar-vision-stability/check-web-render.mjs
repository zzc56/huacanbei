
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../.cache/radar-vision-stability/', import.meta.url));
const { WebSocketServer } = await import(new URL('../../sentinel-backend/node_modules/ws/wrapper.mjs', import.meta.url));
const source = JSON.parse(await readFile(join(output, 'stable-browser-frames.json'), 'utf8'));
const { grid, browserFrames } = source;
assert.equal(new Set(browserFrames.map(frame => frame.visual)).size,2);
const wsServer = new WebSocketServer({ host:'127.0.0.1', port:0 });
await once(wsServer,'listening');
let liveClient;
wsServer.on('connection', socket => { liveClient=socket; });
const fixtureSocket = 'ws://127.0.0.1:'+wsServer.address().port+'/stream';

const serverEntry = new URL('../../web/scripts/serve-dist.mjs', import.meta.url).href;
const staticCode = [
  "import http from 'node:http';",
  'const listen = http.Server.prototype.listen;',
  'http.Server.prototype.listen = function(port,...rest){',
  "  if (port === 4173) { this.once('listening',()=>console.log('TEST_PORT='+this.address().port)); port=0; }",
  '  return listen.call(this,port,...rest);',
  '};',
  'await import('+JSON.stringify(serverEntry)+');',
].join('\n');
const preview=spawn(process.execPath,['--input-type=module','-e',staticCode],{windowsHide:true,stdio:['ignore','pipe','ignore']});
let previewLog='';
preview.stdout.on('data', data=>{previewLog+=data;});
let edge, ws;
const awaitUntil=async (fn,message)=>{
  for(let i=0;i<100;i++){
    try {const value=await fn(); if(value) return value;}catch(error) {
      if (error.code !== 'ENOENT' && !/connect|fetch|context|navigat|environment/i.test(error.message)) throw error;
    }
    await delay(80);
  }
  throw Error(message);
};

try{
  const port = await awaitUntil(()=>previewLog.match(/TEST_PORT=(\d+)/)?.[1], 'The isolated website did not start');
  const profile = await mkdtemp(join(output, 'edge-'));
  const edgePath = process.env.SENTINEL_EDGE_PATH ||
    join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  let browserError;
  edge=spawn(edgePath,[
    '--headless','--no-first-run','--disable-background-networking',
    '--remote-debugging-port=0',
    '--user-data-dir='+profile,'about:blank',
  ],{windowsHide:true,stdio:'ignore'});
  edge.once('error', error => { browserError = error; });
  const edgePort = await awaitUntil(async () => {
    if (browserError) throw Error('Edge could not start. Set SENTINEL_EDGE_PATH to its executable.');
    return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
  }, 'Edge debugging port missing');
  const tab=await awaitUntil(async()=> (await fetch('http://127.0.0.1:'+edgePort+'/json/list').then(r=>r.json())).find(item=>item.type==='page'),'Edge tab missing');
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;
  const requests=new Map();
  ws.onmessage=({data})=>{
    const response=JSON.parse(data), request=requests.get(response.id);
    if(!request) return;
    requests.delete(response.id);
    if(response.error) request.reject(Error(response.error.message));
    else request.resolve(response.result);
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const requestId=++id;
    requests.set(requestId,{resolve,reject});
    ws.send(JSON.stringify({id:requestId,method,params}));
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true});
    if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:920,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:
    'const defaultSocket=window.WebSocket; window.WebSocket=new Proxy(defaultSocket,{construct(Socket,[url,...args]){'+
    'return new Socket(new URL(url).port==="3001" ? '+JSON.stringify(fixtureSocket)+' : url,...args);}});',
  });
  await call('Page.navigate',{url:'http://127.0.0.1:'+port+'/#/?mode=live'});
  await awaitUntil(()=>liveClient,'The website did not connect to the simulated sensor');
  const xAxis=Array.from({length:grid.width},(_,i)=>grid.xMin+(i+.5)*grid.resolution);
  const yAxis=Array.from({length:grid.height},(_,i)=>grid.yMin+(i+.5)*grid.resolution);
  const valid=Array(grid.width*grid.height).fill(true);

  function send(frame) {
    const now=Date.now();
    const time=new Date(now).toISOString();
    liveClient.send(JSON.stringify({
      type:'live_frame', timestamp:now,
      radar:frame.radar.map((obj,i)=>({track_id:obj.id==='car-a'?1:2,
        range:Math.hypot(obj.x,obj.y),angle:Math.atan2(obj.x,obj.y)*180/Math.PI,
        vx_lateral:obj.vx,vy_longitudinal:obj.vy,host_received_utc:time,target_seq:i+1})),
      vision:null,
      context:{source:'live',dispatchHz:10,bounds:{xMin:xAxis[0],xMax:xAxis.at(-1),yMin:yAxis[0],yMax:yAxis.at(-1)},radarMaxRange:200},
      live:{radar:{state:'streaming',lastCycleAt:now},camera:{state:frame.visual?'streaming':'stale'},fusion:{state:frame.visual?'radar_vision':'radar_only'}},
      snapshot:{field_available:true, field_scope:frame.visual?'radar_vision':'radar_only', observation_utc:time,
        valid_until_utc:new Date(now+1500).toISOString(), grid_width:grid.width,grid_height:grid.height,
        x_axis:xAxis,y_axis:yAxis,display_field:frame.field,valid_field_mask:valid},
    }));
    return now;
  }
  const first=send(browserFrames[0]);
  await awaitUntil(()=>evaluate('document.querySelector("canvas[data-view=risk]")?.dataset.fieldTimestamp === '+JSON.stringify(String(first))),'Risk canvas did not display the first field');
  await evaluate('(()=>{const canvas=document.querySelector("canvas[data-view=risk]");'+
    'const m=window.fieldAudit={canvas,draws:0,replaced:0,blank:0,missing:0,scopes:new Set(),timestamps:new Set()};'+
    'const watch=()=>{const current=document.querySelector("canvas[data-view=risk]");m.draws++;'+
    'if(current!==canvas)m.replaced++;if(!current?.dataset.fieldTimestamp)m.missing++;'+
    'if(current?.dataset.fieldScope)m.scopes.add(current.dataset.fieldScope);'+
    'm.timestamps.add(current?.dataset.fieldTimestamp);'+
    'if(current?.width&&current?.height){const rgba=current.getContext("2d").getImageData(Math.floor(current.width/2),Math.floor(current.height/2),1,1).data; if(rgba[3]===0)m.blank++;}'+
    'requestAnimationFrame(watch);};requestAnimationFrame(watch);})()');
  for(const frame of browserFrames.slice(1)){
    send(frame);
    await delay(100);
  }
  const audit=await evaluate('(()=>{const m=window.fieldAudit;return {draws:m.draws,replaced:m.replaced,blank:m.blank,missing:m.missing,scopes:[...m.scopes],updates:m.timestamps.size};})()');
  assert.deepEqual(audit.scopes.sort(),['radar_only','radar_vision']);
  assert.ok(audit.updates>=browserFrames.length-3);
  assert.equal(audit.replaced,0);
  assert.equal(audit.blank,0);
  assert.equal(audit.missing,0);
  console.log(JSON.stringify({fedFrames:browserFrames.length,...audit}));
}finally{
  if(ws?.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify({id:99001,method:'Browser.close'}));
    await delay(300);
    if(ws.readyState===WebSocket.OPEN)ws.close();
  }
  edge?.kill();
  preview.kill();
  for(const socket of wsServer.clients) socket.terminate();
  wsServer.close();
}
