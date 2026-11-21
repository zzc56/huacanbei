import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { DriveDirection, DriveSnapshot } from '../../../../sentinel-backend/src/vehicle/contracts';

const forwardKeys = ['KeyW', 'ArrowUp'];
const reverseKeys = ['KeyS', 'ArrowDown'];
const directions = [...forwardKeys, ...reverseKeys];

export function useVehicleDrive(active: Ref<boolean>, endpoint: URL) {
  const snapshot = shallowRef<DriveSnapshot | null>(null);
  const held = ref(new Set<string>());
  const locked = ref(false), online = ref(false), expanded = ref(false);
  const has = (keys: string[]) => keys.some(k => held.value.has(k));
  const direction = computed<DriveDirection>(() => {
    const forward = has(forwardKeys), reverse = has(reverseKeys);
    if (locked.value || forward === reverse) return 'stop';
    return forward ? 'forward' : 'reverse';
  });
  let socket: WebSocket | undefined;
  function send(action: string) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(action);
  }
  function stop() {
    held.value.clear();
    locked.value = false;
    send('stop');
  }
  function reset() { stop(); send('reset'); }
  function enlarge() { stop(); expanded.value = !expanded.value; }
  function key(event: KeyboardEvent) {
    if (event.code === 'Escape' && expanded.value) { enlarge(); return; }
    if (!directions.includes(event.code) && event.code !== 'Space') return;
    const down = event.type === 'keydown';
    if (down && (document.hidden || !online.value || expanded.value || event.altKey || event.metaKey || event.ctrlKey ||
      (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input,textarea,select'))))) return;
    event.preventDefault();
    if (down && event.repeat) return;
    const previous = direction.value;
    if (down) held.value.add(event.code);
    else held.value.delete(event.code);
    if (down && event.code === 'Space') { locked.value = true; send('stop'); }
    if (!has(directions) && !held.value.has('Space')) locked.value = false;
    if (direction.value !== previous) send(direction.value);
  }
  function visibility() { if (document.hidden) stop(); }
  watch(active, (enabled, _, cleanup) => {
    if (!enabled) return;
    let disposed = false, reconnect: ReturnType<typeof setTimeout>;
    let lastFrame = performance.now();
    const url = new URL('/api/vehicle/drive', endpoint);
    url.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    function connect() {
      const ws = socket = new WebSocket(url);
      lastFrame = performance.now();
      ws.onmessage = event => {
        if (disposed || ws !== socket) return;
        const state: DriveSnapshot = JSON.parse(event.data);
        lastFrame = performance.now();
        online.value = true;
        if (state.timedOut && direction.value !== 'stop') stop();
        snapshot.value = state;
      };
      ws.onclose = () => {
        if (disposed) return;
        online.value = false; snapshot.value = null; stop();
        reconnect = setTimeout(connect, 900);
      };
    }
    connect();
    const heartbeat = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (performance.now() - lastFrame > 900 || socket.bufferedAmount > 4096) {
        stop(); online.value = false; socket.close(); return;
      }
      if (!document.hidden && direction.value !== 'stop') send('heartbeat');
    }, 100);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', stop);
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', visibility);
    cleanup(() => {
      disposed = true; stop(); socket?.close(); socket = undefined;
      clearInterval(heartbeat); clearTimeout(reconnect);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', stop);
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', visibility);
      expanded.value = false; online.value = false; snapshot.value = null;
    });
  }, { immediate:true, flush:'sync' });
  onScopeDispose(() => { socket?.close(); });
  return { snapshot, held, locked, online, expanded, direction, reset, enlarge, stop };
}
