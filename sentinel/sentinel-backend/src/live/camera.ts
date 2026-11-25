import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

export interface CameraOptions { url?: string; python?: string; modelPath?: string }
interface Detection { x:number; y:number; width:number; height:number; score:number; label:string; track_id:string; previewOnly?:true }
interface CameraFrame { sequence:number; capturedAt:number; width:number; height:number; detections:Detection[]; detector:string; jpeg:Buffer; timing:Record<string,number> }
const defaultDetectionLabels = ['person','bicycle','car','motorcycle','bus','truck'];
const displayPresets = {
  traffic: new Set(defaultDetectionLabels),
  ball: new Set(['sports ball']),
  sports: new Set(['person','sports ball']),
};
type DisplayPreset = keyof typeof displayPresets;
function supportsPreset(preset: DisplayPreset, available: readonly string[]) {
  const labels = displayPresets[preset];
  return preset === 'sports'
    ? [...labels].every(label=>available.includes(label))
    : available.some(label=>labels.has(label));
}

/** A bounded cache keeps the image and detections from a sequence together. */
export class CameraFrameStore {
  private frames = new Map<number, CameraFrame>();
  private latest: CameraFrame | undefined;
  private state = 'not-connected';
  private message = '等待外接网络摄像头连接与 RTSP 地址';
  private listeners = new Set<() => void>();
  protected detectionLabels: ReadonlySet<string> | undefined;
  protected displayPreset: DisplayPreset | null = null;
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
        detections.push({x:d.x,y:d.y,width:d.width,height:d.height,score:d.score,label:d.label.slice(0,32),track_id:d.track_id,
          ...(d.previewOnly===true ? {previewOnly:true as const} : {})});
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
  image(sequence:number, capturedAt?:number) {
    const frame=this.frames.get(sequence);
    return capturedAt === undefined || frame?.capturedAt === capturedAt ? frame?.jpeg : undefined;
  }
  snapshot(now=Date.now()) {
    return this.snapshotFrame(this.latest,now);
  }
  displaySnapshot(capture: ReturnType<CameraFrameStore['snapshot']>, now: number) {
    if (!capture.vision) return capture;
    const labels = this.displayPreset ? displayPresets[this.displayPreset] : this.detectionLabels;
    return this.snapshotFrame(this.frames.get(capture.vision.sequence), now, labels, true);
  }
  snapshotsSince(capturedAt:number,now:number) {
    if(this.state!=='streaming')return [];
    return [...this.frames.values()].reverse()
      .filter(frame=>frame.capturedAt>=capturedAt&&frame.capturedAt<=now)
      .map(frame=>this.snapshotFrame(frame,now));
  }
  private snapshotFrame(f:CameraFrame|undefined,now:number, labels = this.detectionLabels, includePreview = false) {
    const fresh=!!f&&now-f.capturedAt<=1500;
    const detections=f?.detections.filter(box=>(includePreview||!box.previewOnly)&&(!labels||labels.has(box.label)))??[];
    return {
      vision:fresh?{sequence:f.sequence,captured_utc:new Date(f.capturedAt).toISOString(),width:f.width,height:f.height,
        detections,imageUrl:`/api/live/camera/${f.sequence}.jpg`}:null,
      status:{state:this.state==='streaming'&&!fresh?'stale':this.state,
        message:this.state==='streaming'
          ? (fresh ? `${f.width} × ${f.height} · ${f.detector} · ${detections.length} 个检测目标` : '摄像头数据超时，等待重新连接')
          : this.message,
        ageMs:f?now-f.capturedAt:null,sequence:f?.sequence??0,detector:f?.detector??'未启用',timing:f?.timing??{}},
    };
  }
}

export function registerCameraFrames(app: FastifyInstance, camera: CameraFrameStore) {
  app.get<{Params:{sequence:string}; Querystring:{at?:string}}>('/api/live/camera/:sequence.jpg', async (request,reply) => {
    const at = request.query.at;
    const jpeg = camera.image(Number(request.params.sequence), at === undefined ? undefined : Number(at));
    if (!jpeg) return reply.code(404).send({error:'Camera frame expired or unavailable'});
    return reply.header('Cache-Control','no-store').type('image/jpeg').send(jpeg);
  });
}

export class LiveCamera extends CameraFrameStore {
  private child:ChildProcessWithoutNullStreams|undefined;
  private retry:ReturnType<typeof setTimeout>|undefined;
  private disposed=false;
  private availableLabels: string[] = [];
  constructor(private options:CameraOptions={}) {
    super();
    this.detectionLabels = new Set(defaultDetectionLabels);
    this.displayPreset = 'traffic';
    const url=options.url??process.env['CAMERA_RTSP_URL'];
    if(url || /^\d+$/.test(process.env['CAMERA_DEVICE_INDEX']??''))this.start(url??'');
  }
  detectionSettings() {
    const labels = this.displayPreset
      ? [...displayPresets[this.displayPreset]].filter(label=>this.availableLabels.includes(label))
      : [...(this.detectionLabels??[])];
    return {
      available:this.availableLabels,
      selected:labels,
      preset:this.displayPreset,
    };
  }
  selectDisplayPreset(preset: unknown) {
    if (preset !== 'traffic' && preset !== 'ball' && preset !== 'sports') return false;
    if (!supportsPreset(preset,this.availableLabels)) return false;
    this.displayPreset = preset;
    return true;
  }
  selectDetectionLabels(labels: unknown) {
    if (!Array.isArray(labels) || labels.length > this.availableLabels.length ||
        !labels.every(label=>typeof label==='string' && this.availableLabels.includes(label))) return false;
    this.detectionLabels = new Set(labels);
    this.displayPreset = null;
    return true;
  }
  private updateDetectionCatalog(labels: unknown) {
    if (!Array.isArray(labels) || !labels.length) return;
    const available = [...new Set(labels.filter((label):label is string=>typeof label==='string'&&label.length>0)
      .map(label=>label.slice(0,32)))];
    if (!available.length) return;
    const identical = available.length === this.availableLabels.length && available.every(label=>this.availableLabels.includes(label));
    if (!identical) {
      const defaults = available.filter(label=>defaultDetectionLabels.includes(label));
      this.detectionLabels = new Set(defaults.length ? defaults : available);
    }
    this.availableLabels = available;
    const preset = this.displayPreset;
    if (preset && !supportsPreset(preset,available)) {
      this.displayPreset = null;
    }
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
          else if(value['type']==='camera_classes')this.updateDetectionCatalog(value['labels']);
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

export function registerCameraDetectionSettings(app: FastifyInstance, camera: LiveCamera, origins: ReadonlySet<string>) {
  app.get('/api/vehicle/camera-classes', (_request, reply) => {
    reply.header('Cache-Control','no-store');
    return camera.detectionSettings();
  });
  app.post<{Body:{selected?:unknown;preset?:unknown}}>('/api/vehicle/camera-classes', {bodyLimit:65536}, (request,reply)=>{
    const origin=request.headers.origin;
    const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip);
    if (!origin || !loopback || !origins.has(origin)) return reply.code(403).send({error:'请在本机网页选择检测类别。'});
    if (!camera.detectionSettings().available.length) return reply.code(409).send({error:'检测模型还未就绪。'});
    if (request.body?.preset !== undefined) {
      if (!camera.selectDisplayPreset(request.body.preset)) return reply.code(400).send({error:'当前检测模型不支持该模式。'});
      return camera.detectionSettings();
    }
    if (!camera.selectDetectionLabels(request.body?.selected)) return reply.code(400).send({error:'请选择当前检测模型支持的类别。'});
    return camera.detectionSettings();
  });
}
