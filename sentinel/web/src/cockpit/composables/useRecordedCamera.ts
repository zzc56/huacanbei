import { watch, onUnmounted, shallowRef, type Ref } from 'vue';
import { useSceneStore } from '../stores/scene';
import type { Target, Frame } from '../types';
/** Atomically commit one image and its exact detection frame; slow decoding never mixes frames. */
export function useRecordedCamera(video: Ref<HTMLVideoElement | null>, enabled?: Ref<boolean>) {
  const store=useSceneStore();
  const ready=shallowRef<{image:HTMLImageElement;targets:Target[];meta:NonNullable<Frame['cameraFrame']>}|null>(null);
  type Request = { meta:NonNullable<Frame['cameraFrame']>; targets:Target[]; source:Frame['source'] };
  let desired:Request|undefined, pending:HTMLImageElement|undefined, attemptedUrl='', disposed=false;
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const syncVideo=()=>{
    const el=video.value,m=store.frame.cameraFrame;
    if(enabled?.value===false||!el||!m||el.readyState<1||m.videoTimeSeconds===undefined)return;
    el.pause(); // Recording is advanced by the shared replay clock, never a second free-running clock.
    if(Math.abs(el.currentTime-m.videoTimeSeconds)>.025)el.currentTime=m.videoTimeSeconds;
  };
  const cancel=()=>{
    clearTimeout(timeout);
    if(pending){pending.onload=pending.onerror=null;pending.src='';pending=undefined;}
  };
  const loadLatest=()=>{
    const request=desired;
    if(disposed||pending||!request?.meta.imageUrl||request.meta.imageUrl===attemptedUrl)return;
    attemptedUrl=request.meta.imageUrl;
    const image=pending=new Image();
    const finish=(success:boolean)=>{
      if(pending!==image||disposed)return;
      clearTimeout(timeout);pending=undefined;image.onload=image.onerror=null;
      const latest=desired?.meta.imageUrl===request.meta.imageUrl;
      // Live playback may finish one in-flight frame while newer frames arrive.
      // Its boxes come from that exact request, never from the newest store frame.
      if(success&&(latest||request.source==='live')&&
        (request.source!=='live'||!store.playing&&latest||Date.now()-request.meta.timestamp<=700)){
        ready.value={image,targets:request.targets,meta:request.meta};syncVideo();
      }else if(latest)ready.value=null;
      if(!success)image.src='';
      loadLatest();
    };
    image.onload=()=>finish(true);image.onerror=()=>finish(false);
    timeout=setTimeout(()=>finish(false),request.source==='live'?700:5000);
    image.src=request.meta.imageUrl;
  };
  watch(()=>enabled?.value===false ? undefined : store.frame.cameraFrame?.imageUrl,()=>{
    const m=store.frame.cameraFrame;
    if(enabled?.value===false){desired=undefined;attemptedUrl='';cancel();ready.value=null;return;}
    if(!m?.imageUrl){
      // 回放首尾以及两次采集之间的空档没有视觉帧，保留上一张图，避免整块画面变白。
      if(store.frame.source==='live'){desired=undefined;attemptedUrl='';cancel();ready.value=null;}
      return;
    }
    if(desired && (desired.source!==store.frame.source || m.sequence<desired.meta.sequence)){
      cancel();attemptedUrl='';ready.value=null;
    }
    desired={meta:m,targets:store.frame.targets.filter(t=>t.camera),source:store.frame.source};
    loadLatest();syncVideo();
  },{immediate:true});
  // A fusion update can resolve an ID without changing the camera frame. Keep
  // selectable boxes in sync with the store without decoding the image again.
  watch(()=>store.frame,frame=>{
    if(desired && desired.meta.sequence===frame.cameraFrame?.sequence)
      desired.targets=frame.targets.filter(t=>t.camera);
    if(ready.value && ready.value.meta.sequence===frame.cameraFrame?.sequence)
      ready.value={...ready.value,targets:frame.targets.filter(t=>t.camera)};
  });
  onUnmounted(()=>{disposed=true;desired=undefined;cancel();});
  return {ready,syncVideo};
}
