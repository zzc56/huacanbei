import { onMounted, onUnmounted, type Ref } from 'vue';
/** ResizeObserver + DPR 缩放；卸载时释放所有监听和 RAF。 */
export function useCanvas(
  canvas: Ref<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  let raf = 0,
    observer: ResizeObserver | undefined,
    width = 0,
    height = 0,
    nextDraw = 0,
    ctx: CanvasRenderingContext2D | null = null;
  onMounted(() => {
    const element = canvas.value;
    if (!element) return;
    ctx = element.getContext('2d');
    observer = new ResizeObserver(() => {
      width = element.clientWidth;
      height = element.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    observer.observe(element);
    const tick = (now: number) => {
      if (ctx && width && height && now >= nextDraw - 0.7) {
        draw(ctx, width, height);
        nextDraw = Math.max(nextDraw + 1000 / 60, now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  onUnmounted(() => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
  });
}
