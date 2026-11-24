import type { ConnectionState, DataStream, Frame } from '../cockpit/types';
import { RealDataAdapter } from './RealDataAdapter';
export class WebSocketStream implements DataStream {
  private socket?: WebSocket;
  private paused=false;
  private disposed=false;
  private connecting=false;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts=0;
  private recording=false;
  private live=false;
  private position=0;
  private configAbort?: AbortController;
  private base: string;
  private adapter: RealDataAdapter;
  private lastFrameAt=0;
  private watchdog?: ReturnType<typeof setInterval>;
  private streaming=true;
  private onFrame:((frame:Frame)=>void)|undefined;
  private onStatus:((state:ConnectionState)=>void)|undefined;
  private onPlayback:((playing:boolean)=>void)|undefined;
  constructor(private url:string) {
    const u=new URL(url,window.location.href); u.protocol=u.protocol==='wss:'?'https:':'http:';
    this.base=u.origin;this.adapter=new RealDataAdapter(this.base);
  }
  start(onFrame:(frame:Frame)=>void,status:(s:ConnectionState)=>void,onPlayback?:(playing:boolean)=>void) {
    this.onFrame=onFrame;this.onStatus=status;this.onPlayback=onPlayback;
    void this.connect();
    // 电脑休眠、网线重插以后，旧连接会一直挂着却不再来帧，onclose 也不一定触发。
    // 这里自己盯着最后一条帧的时间，超过 4 秒没有就主动重连；标签页重新可见时也补一次。
    this.watchdog=setInterval(()=>this.guard(),2000);
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',this.visible);
  }
  private async connect() {
    if(this.disposed||this.connecting||this.socket?.readyState===WebSocket.CONNECTING||this.socket?.readyState===WebSocket.OPEN)return;
    this.connecting=true;
    clearTimeout(this.retry);
    this.onStatus?.('connecting');
    this.configAbort=new AbortController();
    try {
      const signal=AbortSignal.any([this.configAbort.signal,AbortSignal.timeout(3000)]);
      const r=await fetch(this.base+'/api/config',{signal});
      if(r.ok)this.adapter.setConfig(await r.json());
    }catch{}finally{this.connecting=false;}
    if(this.disposed)return;
    try {
      const socket=this.socket=new WebSocket(this.url);
      socket.onopen=()=>{this.attempts=0;this.recording=false;this.live=false;this.lastFrameAt=Date.now();
        this.streaming=!this.paused;this.onStatus?.('connected');if(this.paused)this.send({action:'pause'});};
      socket.onmessage=event=>{
        try {
          const raw=JSON.parse(event.data);
          if(raw?.type==='replay_manifest'){this.recording=true;this.lastFrameAt=Date.now();this.onStatus?.('replay');
            if(this.position)this.send({action:'seek',positionMs:this.position});return;}
          if(raw?.type==='live_manifest'){this.live=true;this.recording=false;this.lastFrameAt=Date.now();this.onStatus?.('connected');return;}
          if(raw?.type==='system_state'){
            if(raw.state==='paused'||raw.state==='playing'){
              this.paused=raw.state==='paused';
              // 回放放到结尾之后服务端不再推帧，这是正常停止，不能当成断线去重连。
              this.streaming=!this.paused&&raw.ended!==true;
              this.onPlayback?.(!this.paused);
            }
            return;
          }
          if(raw?.type==='error'){this.onStatus?.('error');return;}
          const frame=this.adapter.parse(raw);
          if(frame){
            this.lastFrameAt=Date.now();this.streaming=frame.replay?.ended!==true;
            if(frame.replay)this.position=frame.replay.positionMs;
            this.onFrame?.(frame);this.onStatus?.(frame.source==='recording'?'replay':'connected');
          }
        } catch {this.onStatus?.('error');}
      };
      socket.onerror=()=>this.onStatus?.('error');
      socket.onclose=()=>{if(this.disposed)return;this.onStatus?.('disconnected');this.retry=setTimeout(()=>void this.connect(),Math.min(10000,500*2**this.attempts++));};
    } catch {this.onStatus?.('error');this.retry=setTimeout(()=>void this.connect(),2000);}
  }
  private guard(){
    if(this.disposed||this.paused||!this.streaming)return;
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    if(Date.now()-this.lastFrameAt<=4000)return;
    this.onStatus?.('connecting');this.socket.close();
  }
  private visible=()=>{
    if(this.disposed||typeof document==='undefined'||document.visibilityState!=='visible')return;
    if(this.socket?.readyState===WebSocket.OPEN){this.guard();return;}
    if(this.socket?.readyState===WebSocket.CONNECTING||this.socket?.readyState===WebSocket.CLOSING)return;
    this.attempts=0;
    void this.connect();
  };
  private send(value:unknown){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(value));}
  setPaused(paused:boolean){
    if(this.paused===paused)return;this.paused=paused;this.streaming=!paused;this.lastFrameAt=Date.now();
    if(this.recording||this.live)this.send({action:paused?'pause':'play'});
    else if(this.socket?.readyState===WebSocket.OPEN)void fetch(this.base+'/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:paused?'pause':'play'})}).catch(()=>{});
  }
  select(id:string){this.send({action:'select_target',targetId:id==='—'?null:id});}
  seek(positionMs:number){this.position=Math.max(0,positionMs);this.send({action:'seek',positionMs:this.position});}
  dispose(){this.disposed=true;clearTimeout(this.retry);clearInterval(this.watchdog);
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',this.visible);
    this.configAbort?.abort();if(this.socket){this.socket.onclose=this.socket.onerror=this.socket.onmessage=this.socket.onopen=null;this.socket.close();}}
}
export class ApiStream implements DataStream {
  private timer?:ReturnType<typeof setInterval>;private abort?:AbortController;private paused=false;private disposed=false;private pending=false;private position=0;private last=performance.now();
  private seekRevision=0;
  private needsFrame=true;
  constructor(private url:string){}
  setPaused(value:boolean){this.paused=value;this.last=performance.now();}
  seek(value:number){
    if(!Number.isFinite(value))return;
    this.position=Math.max(0,value);
    this.last=performance.now();
    this.seekRevision++;
    this.needsFrame=true;
    this.abort?.abort();
  }
  start(onFrame:(frame:Frame)=>void,status:(state:ConnectionState)=>void){
    const adapter=new RealDataAdapter(this.url);
    const poll=async()=>{
      const now=performance.now();if(!this.paused)this.position+=now-this.last;this.last=now;
      if(this.pending||this.paused&&!this.needsFrame)return;
      this.pending=true;
      const request=this.abort=new AbortController();
      const revision=this.seekRevision;
      try{
        const url=new URL(this.url,window.location.href);
        url.searchParams.set('timeMs',String(this.position));
        const response=await fetch(url,{signal:request.signal});
        if(!response.ok)throw Error('HTTP');
        const packet=await response.json();
        if(this.disposed||revision!==this.seekRevision)return;
        const frame=adapter.parse(packet);
        if(!frame)throw Error('Frame');
        this.needsFrame=false;
        onFrame(frame);
        status(frame.source==='recording'?'replay':'connected');
      }catch{
        if(!this.disposed&&!request.signal.aborted)status('error');
      }finally{this.pending=false;}
    };
    status('connecting');void poll();this.timer=setInterval(()=>void poll(),100);
  }
  dispose(){this.disposed=true;clearInterval(this.timer);this.abort?.abort();}
}
