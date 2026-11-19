import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';

export interface CameraOptions { url?: string; python?: string; modelPath?: string }
interface Detection { x:number; y:number; width:number; height:number; score:number; label:string; track_id:string }
interface CameraFrame { sequence:number; capturedAt:number; width:number; height:number; detections:Detection[]; detector:string; jpeg:Buffer; timing:Record<string,number> }

/** A bounded cache keeps the image and detections from a sequence together. */
export class CameraFrameStore {
  private frames = new Map<number, CameraFrame>();
  private latest: CameraFrame | undefined;
  private state = 'not-connected';
  private message = '等待外接网络摄像头连接与 RTSP 地址';
  private listeners = new Set<() => void>();
  onFrame(listener:()=>void) { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; }
  status(state:string,message:string) { this.state=state; this.message=message; }
  clear(state:string,message:string) { this.latest=undefined; this.frames.clear(); this.status(state,message); }
  accept(value:unknown, now=Date.now()):boolean {
    if (!value || typeof value!=='object') return false;
    const r=value as Record<string,unknown>;
    const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
    if(!finite(r['sequence'])||!Number.isSafeInteger(r['sequence'])||r['sequence']<1
      ||!finite(r['capturedAt'])||now-r['capturedAt']>1500||r['capturedAt']>now+500
      ||!finite(r['width'])||!finite(r['height'])||r['width']<1||r['height']<1||r['width']*r['height']>16777216
      ||typeof r['jpeg']!=='string'||r['jpeg'].length>2_000_000||!Array.isArray(r['detections']))return false;
    const jpeg=Buffer.from(r['jpeg'],'base64');
    if(jpeg.length<4||jpeg[0]!==255||jpeg[1]!==216||jpeg.at(-2)!==255||jpeg.at(-1)!==217)return false;
    const detections:Detection[]=[];
    for(const d of r['detections'].slice(0,100)){
      if(!d||typeof d!=='object')continue;
      if(['x','y','width','height','score'].every(k=>finite(d[k]))&&d.width>0&&d.height>0&&d.score>=0&&d.score<=1
        &&typeof d.label==='string'&&typeof d.track_id==='string'&&/^V\d{1,12}$/.test(d.track_id)){
        detections.push({x:d.x,y:d.y,width:d.width,height:d.height,score:d.score,label:d.label.slice(0,32),track_id:d.track_id});
      }
    }
    if(this.latest && (r['sequence']<=this.latest.sequence || r['capturedAt']<this.latest.capturedAt))return false;
    const timing:Record<string,number>={};
    if(r['timing']&&typeof r['timing']==='object')for(const [key,value] of Object.entries(r['timing'])){
      if(['inferenceMs','encodeMs','processingMs','decodeThreads','inferenceThreads'].includes(key)&&finite(value)&&value>=0)timing[key]=value;
    }
    const f:CameraFrame={sequence:r['sequence'],capturedAt:r['capturedAt'],width:r['width'],height:r['height'],
      detections,detector:typeof r['detector']==='string'?r['detector']:'未启用',jpeg,timing};
    this.latest=f;this.frames.set(f.sequence,f);
    while(this.frames.size>32)this.frames.delete(this.frames.keys().next().value!);
    this.status('streaming',`${f.width} × ${f.height} · ${f.detector} · ${detections.length} 个检测目标`);
    for(const listener of this.listeners)listener();
    return true;
  }
  image(sequence:number) { return this.frames.get(sequence)?.jpeg; }
  snapshot(now=Date.now()) {
    const f=this.latest, fresh=!!f&&now-f.capturedAt<=1500;
    return {
      vision:fresh?{sequence:f.sequence,captured_utc:new Date(f.capturedAt).toISOString(),width:f.width,height:f.height,
        detections:f.detections,imageUrl:`/api/live/camera/${f.sequence}.jpg`}:null,
      status:{state:this.state==='streaming'&&!fresh?'stale':this.state,
        message:this.state==='streaming'&&!fresh?'摄像头数据超时，等待重新连接':this.message,
        ageMs:f?now-f.capturedAt:null,sequence:f?.sequence??0,detector:f?.detector??'未启用',timing:f?.timing??{}},
    };
  }
}

export class LiveCamera extends CameraFrameStore {
  private child:ChildProcessWithoutNullStreams|undefined;
  private retry:ReturnType<typeof setTimeout>|undefined;
  private disposed=false;
  constructor(private options:CameraOptions={}) {
    super();
    const url=options.url??process.env['CAMERA_RTSP_URL'];
    if(url)this.start(url);
  }
  private start(url:string) {
    if(this.disposed)return;
    this.status('connecting','正在连接网络视频并加载本机检测模型');
    const child=this.child=spawn(this.options.python??process.env['CAMERA_PYTHON']??'python',
      ['-u',resolve('scripts/live-camera.py')],{windowsHide:true,stdio:'pipe',
        env:{...process.env,CAMERA_RTSP_URL:url,CAMERA_MODEL_PATH:this.options.modelPath??process.env['CAMERA_MODEL_PATH']??''}});
    let pending='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
      pending+=chunk;
      if(pending.length>3_000_000){pending='';return;}
      let end:number;
      while((end=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,end);pending=pending.slice(end+1);
        try{
          const value=JSON.parse(line) as Record<string,unknown>;
          if(value['type']==='camera_frame')this.accept(value);
          else if(value['type']==='camera_status'&&typeof value['state']==='string'&&typeof value['message']==='string')
            this.status(value['state'],value['message']);
        }catch{/* Non-JSON dependency notices never break the data stream. */}
      }
    });
    // Drain codec diagnostics; RTSP credentials must never enter application logs.
    child.stderr.resume();
    child.on('error',()=>this.clear('error','摄像头进程未能启动，请检查 CAMERA_PYTHON 和本机依赖'));
    child.on('close',()=>{
      if(this.disposed)return;
      this.clear('disconnected','摄像头采集进程已退出，正在重连');
      this.retry=setTimeout(()=>this.start(url),3000);
    });
  }
  close(){this.disposed=true;clearTimeout(this.retry);this.child?.kill();}
}
