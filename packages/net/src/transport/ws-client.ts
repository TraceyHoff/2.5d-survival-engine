import type { Channel, ClientTransport } from "./types.js";

/** Minimal structural WebSocket type (browser WebSocket and the `ws` package both satisfy it). */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;
const OPEN = 1;

/**
 * Browser WebSocket client transport. Both channels ride the same TCP stream; "unreliable"
 * sends are dropped while the socket is backed up (bufferedAmount > limit) to avoid latency build-up.
 */
export class WebSocketClientTransport implements ClientTransport {
  private ws: WebSocketLike | undefined;
  private messageFns: ((b: Uint8Array, ch: Channel) => void)[] = [];
  private closeFns: (() => void)[] = [];
  constructor(private readonly url: string, private readonly ctor?: WebSocketCtor, private readonly unreliableBufferLimit = 64 * 1024) {}
  get connected(): boolean { return this.ws?.readyState === OPEN; }
  connect(): Promise<void> {
    const Ctor = this.ctor ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) return Promise.reject(new Error("WebSocket not available"));
    const ws = new Ctor(this.url); ws.binaryType = "arraybuffer"; this.ws = ws;
    return new Promise((resolve, reject) => {
      let opened = false;
      ws.onopen = () => { opened = true; resolve(); };
      ws.onerror = () => { if (!opened) reject(new Error(`WebSocket connect failed: ${this.url}`)); };
      ws.onclose = () => { if (!opened) reject(new Error("WebSocket closed")); this.ws = undefined; for (const f of this.closeFns) f(); };
      ws.onmessage = (ev) => {
        const d = ev.data;
        const bytes = d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Uint8Array ? d : undefined;
        if (bytes) for (const f of this.messageFns) f(bytes, "reliable");
      };
    });
  }
  send(bytes: Uint8Array, channel: Channel): void {
    const ws = this.ws; if (!ws || ws.readyState !== OPEN) return;
    if (channel === "unreliable" && ws.bufferedAmount > this.unreliableBufferLimit) return;
    ws.send(bytes);
  }
  onMessage(fn: (b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  onClose(fn: () => void): void { this.closeFns.push(fn); }
  close(): void { this.ws?.close(); }
}
