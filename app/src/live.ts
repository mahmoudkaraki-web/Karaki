// The live line to the server (WebSocket at /ws). It signs in with the session token, tries again
// with growing pauses when the line drops, and is closed while the app is in the background so
// the server knows to send a push instead.
import { socketUrl } from './api';

type Handler = (ev: any) => void;

export class Live {
  private ws: WebSocket | null = null;
  private token: string;
  private onEvent: Handler;
  private onState: (connected: boolean) => void;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private refN = 0;
  private waiting = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; t: ReturnType<typeof setTimeout> }>();
  connected = false;

  constructor(token: string, onEvent: Handler, onState: (connected: boolean) => void) {
    this.token = token;
    this.onEvent = onEvent;
    this.onState = onState;
  }

  open() {
    this.wanted = true;
    if (this.ws) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const ws = new WebSocket(socketUrl());
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    ws.onmessage = (m) => {
      let ev: any;
      try { ev = JSON.parse(String(m.data)); } catch { return; }
      if (ev.type === 'ready') { this.retry = 0; this.setConnected(true); }
      if (ev.ref && this.waiting.has(ev.ref)) {
        const w = this.waiting.get(ev.ref)!;
        this.waiting.delete(ev.ref);
        clearTimeout(w.t);
        if (ev.type === 'error') w.reject(Object.assign(new Error(ev.code), { code: ev.code }));
        else w.resolve(ev);
        return;
      }
      this.onEvent(ev);
    };
    ws.onclose = (e) => {
      if (this.ws === ws) this.ws = null;
      this.setConnected(false);
      for (const [, w] of this.waiting) { clearTimeout(w.t); w.reject(new Error('closed')); }
      this.waiting.clear();
      if (e.code === 4001) { this.wanted = false; this.onEvent({ type: 'signed_out' }); return; }
      if (this.wanted) this.schedule();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private schedule() {
    const wait = Math.min(30_000, 1000 * 2 ** this.retry) + Math.random() * 500;
    this.retry = Math.min(this.retry + 1, 6);
    this.timer = setTimeout(() => { this.timer = null; this.open(); }, wait);
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    this.onState(v);
  }

  close() {
    this.wanted = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setConnected(false);
  }

  send(obj: object) {
    if (!this.connected || !this.ws) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  request<T = any>(obj: object, ms = 15_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const ref = `r${++this.refN}`;
      if (!this.send({ ...obj, ref })) return reject(new Error('offline'));
      const t = setTimeout(() => { this.waiting.delete(ref); reject(new Error('timeout')); }, ms);
      this.waiting.set(ref, { resolve, reject, t });
    });
  }
}
