import { onUnmounted, ref, watch, type Ref } from 'vue';
import type { VideoSource } from '../types';
import { useSceneStore } from '../stores/scene';
export function useVideoSource(video: Ref<HTMLVideoElement | null>) {
  const store = useSceneStore();
  const sourceDialog = ref(false),
    sourceType = ref<VideoSource['type']>('video'),
    sourceUrl = ref(''),
    sourceError = ref(''),
    validationError = ref('');
  const videoReady = ref(false);
  let socket: WebSocket | undefined,
    carlaImage: ImageBitmap | undefined,
    sourceGeneration = 0;
  function cleanupSource() {
    sourceGeneration++;
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      socket = undefined;
    }
    carlaImage?.close();
    carlaImage = undefined;
    videoReady.value = false;
  }
  watch(
    () => store.videoSource,
    (source) => {
      cleanupSource();
      sourceError.value = '';
      if (source.type === 'carla' && source.url) {
        const generation = sourceGeneration;
        let decoding = false;
        try {
          socket = new WebSocket(source.url);
          socket.binaryType = 'blob';
          socket.onerror = () => {
            sourceError.value = 'CARLA 图像流连接失败';
          };
          socket.onclose = () => {
            if (generation === sourceGeneration) sourceError.value = 'CARLA 图像流已断开';
          };
          socket.onmessage = async (event) => {
            if (!(event.data instanceof Blob) || !store.playing || decoding) return;
            decoding = true;
            try {
              const bitmap = await createImageBitmap(event.data);
              if (generation !== sourceGeneration || !store.playing) bitmap.close();
              else {
                carlaImage?.close();
                carlaImage = bitmap;
                videoReady.value = true;
              }
            } catch {
              sourceError.value = '无法解码 CARLA 图像帧';
            } finally {
              decoding = false;
            }
          };
        } catch {
          sourceError.value = '无法建立 CARLA 图像流';
        }
      }
    },
    { deep: true, immediate: true },
  );
  watch(
    () => store.playing,
    (playing) => {
      if (video.value && store.videoSource.type === 'video') {
        if (playing)
          void video.value.play().catch(() => {
            sourceError.value = '点击画面以允许视频播放';
          });
        else video.value.pause();
      }
    },
  );
  onUnmounted(cleanupSource);
  function openSource(type: VideoSource['type']) {
    validationError.value = '';
    if (type === 'mock') {
      store.videoSource = { type: 'mock' };
      return;
    }
    sourceType.value = type;
    sourceUrl.value = store.videoSource.type === type ? store.videoSource.url || '' : '';
    sourceError.value = '';
    sourceDialog.value = true;
  }
  function applySource() {
    try {
      const url = new URL(sourceUrl.value, window.location.href);
      if (
        sourceType.value === 'carla'
          ? !['ws:', 'wss:'].includes(url.protocol)
          : !['http:', 'https:', 'blob:'].includes(url.protocol)
      )
        throw new Error();
      store.videoSource = { type: sourceType.value, url: url.href };
      sourceDialog.value = false;
    } catch {
      validationError.value =
        sourceType.value === 'carla'
          ? '请输入 ws:// 或 wss:// 图像流地址'
          : '请输入 HTTP(S) 视频地址（浏览器可解码）';
    }
  }
  function onVideoReady() {
    videoReady.value = true;
    if (store.playing)
      void video.value?.play().catch(() => {
        sourceError.value = '点击画面以允许视频播放';
      });
  }

  return {
    sourceDialog,
    sourceType,
    sourceUrl,
    sourceError,
    validationError,
    videoReady,
    openSource,
    applySource,
    onVideoReady,
    getImage: () => carlaImage,
  };
}
