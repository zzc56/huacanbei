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
    const measure = () => {
      width = element.clientWidth;
      height = element.clientHeight;
    };
    measure();
    observer = new ResizeObserver(measure);
    observer.observe(element);
    const tick = (now: number) => {
      if (ctx && width && height && now >= nextDraw - 0.7) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.round(width * dpr);
        const pixelHeight = Math.round(height * dpr);
        // Resizing clears the canvas. Resize and paint together, before the browser presents it.
        if (element.width !== pixelWidth) element.width = pixelWidth;
        if (element.height !== pixelHeight) element.height = pixelHeight;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
