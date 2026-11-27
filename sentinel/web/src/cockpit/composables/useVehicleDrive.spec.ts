import { effectScope, ref } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { useVehicleDrive } from './useVehicleDrive';

it('stops on a hidden document, ignores a held key on return, and removes shortcuts on exit', () => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {hidden:false});
  const commands:string[] = [];
  let stream!: FakeSocket;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onmessage?: (event:{data:string}) => void;
    constructor() { stream = this; }
    send(command:string) { commands.push(command); }
    close() { this.readyState = 3; }
  }
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('WebSocket', FakeSocket);
  const key = (type:string, repeat=false) => win.dispatchEvent(Object.assign(new Event(type), {code:'KeyW',repeat}));
  const scope = effectScope();
  try {
    const active = ref(true);
    const calibrating = ref(true);
    scope.run(() => useVehicleDrive(active, new URL('http://localhost'), calibrating));
    stream.onmessage!({data:'{}'});
    key('keydown');
    key('keyup');
    expect(commands).toEqual([]);
    stream.onmessage!({data:'{"bench":{"phase":"ready"}}'});
    key('keydown');
    key('keyup');
    expect(commands).toEqual([]);
    calibrating.value = false;
    key('keydown');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    key('keydown');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    key('keydown',true);
    expect(commands).toEqual(['forward','stop']);
    key('keyup'); key('keydown');
    active.value = false;
    key('keyup'); key('keydown');
    expect(commands).toEqual(['forward','stop','forward','stop']);
    expect(stream.readyState).toBe(3);
  } finally { scope.stop(); }
});

afterEach(() => vi.unstubAllGlobals());
