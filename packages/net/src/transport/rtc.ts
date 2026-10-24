/**
 * WebRTC data-channel transports (browser P2P). Signaling-agnostic: callers hand in an opened `RtcPeerLink`
 * (two pipes over one RTCPeerConnection): "reliable" = ordered + reliable (handshake, commands, chat, events),
 * "unreliable" = unordered, maxRetransmits 0 (snapshots / input windows; the protocol already tolerates loss).
 * Host leave: the host sends one EMPTY frame on the reliable pipe (the net protocol never sends empty messages),
 * so guests can tell "host ended the session" apart from a dropped connection.
 */
import type { Channel, ClientTransport, ConnId, ServerTransport } from "./types.js";

/** Minimal message pipe (an RTCDataChannel adapter, or the in-memory fake in fake-channel.ts). */
export interface DataPipe {
  readonly open: boolean;
  readonly bufferedAmount: number;
  send(bytes: Uint8Array): void;
  close(): void;
  onOpen(fn: () => void): void;
  onMessage(fn: (bytes: Uint8Array) => void): void;
  onClose(fn: () => void): void;
}
export interface RtcPeerLink { reliable: DataPipe; unreliable: DataPipe; /** Tears down the peer connection. */ close(): void }
export type RtcCloseReason = "host-ended" | "connection-lost" | "local";
/** Empty reliable frame = graceful host shutdown ("bye"). */
export const RTC_BYE = new Uint8Array(0);

/** Structural RTCDataChannel (browser lib types not required by @engine/net). */
export interface RTCDataChannelLike {
  readonly readyState: string; readonly bufferedAmount: number; binaryType: string;
  send(data: Uint8Array): void; close(): void;
  addEventListener(type: "open" | "close" | "error" | "message", fn: (ev: { data?: unknown }) => void): void;
}
/** Adapts an RTCDataChannel to a DataPipe (uses addEventListener so libraries owning the channel keep working). */
export function pipeFromDataChannel(dc: RTCDataChannelLike): DataPipe {
  dc.binaryType = "arraybuffer";
  let closed = false; const closeFns: (() => void)[] = [];
  const fireClose = (): void => { if (closed) return; closed = true; for (const f of closeFns) f(); };
  dc.addEventListener("close", fireClose); dc.addEventListener("error", fireClose);
  return {
    get open() { return !closed && dc.readyState === "open"; },
    get bufferedAmount() { return dc.bufferedAmount; },
    send: (b) => { if (!closed && dc.readyState === "open") { try { dc.send(b); } catch { /* channel closing */ } } },
    close: () => dc.close(),
    onOpen: (fn) => { if (dc.readyState === "open") queueMicrotask(fn); else dc.addEventListener("open", () => fn()); },
    onMessage: (fn) => dc.addEventListener("message", (ev) => {
      const d = ev.data; const bytes = d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Uint8Array ? d : undefined; if (bytes) fn(bytes);
    }),
    onClose: (fn) => { closeFns.push(fn); },
  };
}

function wire(link: RtcPeerLink, onMsg: (b: Uint8Array, ch: Channel) => void, onBye: () => void, onClose: () => void): void {
  link.reliable.onMessage((b) => { if (b.length === 0) onBye(); else onMsg(b, "reliable"); });
  link.unreliable.onMessage((b) => { if (b.length) onMsg(b, "unreliable"); });
  link.reliable.onClose(onClose); link.unreliable.onClose(onClose);
}
function sendOn(link: RtcPeerLink, bytes: Uint8Array, channel: Channel, unreliableBufferLimit: number): void {
  if (channel === "unreliable") {
    // Unreliable pipe not up yet (or backed up): drop like WS does; the next snapshot supersedes it.
    if (link.unreliable.open && link.unreliable.bufferedAmount <= unreliableBufferLimit) link.unreliable.send(bytes);
  } else if (link.reliable.open) link.reliable.send(bytes);
}

/** Guest side. `open` performs signaling and resolves once both pipes exist (they may still be connecting). */
export class RtcClientTransport implements ClientTransport {
  private link: RtcPeerLink | undefined;
  private isOpen = false;
  private messageFns: ((b: Uint8Array, ch: Channel) => void)[] = [];
  private closeFns: (() => void)[] = [];
  /** Why the transport closed (set before onClose fires). */
  closeReason: RtcCloseReason | undefined;
  constructor(private readonly open: () => Promise<RtcPeerLink>, private readonly unreliableBufferLimit = 64 * 1024) {}
  get connected(): boolean { return this.isOpen; }
  async connect(): Promise<void> {
    const link = await this.open(); this.link = link;
    await new Promise<void>((resolve, reject) => {
      let n = 0; const up = (): void => { if (++n === 2) resolve(); };
      link.reliable.onOpen(up); link.unreliable.onOpen(up);
      link.reliable.onClose(() => { if (n < 2) reject(new Error("peer connection closed during setup")); });
    });
    this.isOpen = true;
    wire(link, (b, ch) => { if (this.isOpen) for (const f of this.messageFns) f(b, ch); },
      () => this.finish("host-ended"), () => this.finish("connection-lost"));
  }
  send(bytes: Uint8Array, channel: Channel): void { if (this.isOpen && this.link) sendOn(this.link, bytes, channel, this.unreliableBufferLimit); }
  onMessage(fn: (b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  onClose(fn: () => void): void { this.closeFns.push(fn); }
  close(): void { this.finish("local"); }
  private finish(reason: RtcCloseReason): void {
    if (!this.isOpen) { this.link?.close(); return; }
    this.isOpen = false; this.closeReason = reason; this.link?.close();
    for (const f of this.closeFns) f();
  }
}

/** Host side: `accept(link)` for each peer that signaling hands over. */
export class RtcServerTransport implements ServerTransport {
  private nextId = 1;
  private conns = new Map<ConnId, RtcPeerLink>();
  private connectFns: ((c: ConnId) => void)[] = [];
  private disconnectFns: ((c: ConnId) => void)[] = [];
  private messageFns: ((c: ConnId, b: Uint8Array, ch: Channel) => void)[] = [];
  constructor(private readonly unreliableBufferLimit = 64 * 1024) {}
  get size(): number { return this.conns.size; }
  accept(link: RtcPeerLink): ConnId {
    const id = this.nextId++; this.conns.set(id, link);
    wire(link, (b, ch) => { if (this.conns.has(id)) for (const f of this.messageFns) f(id, b, ch); }, () => this.drop(id), () => this.drop(id));
    for (const f of this.connectFns) f(id);
    return id;
  }
  onConnect(fn: (c: ConnId) => void): void { this.connectFns.push(fn); }
  onDisconnect(fn: (c: ConnId) => void): void { this.disconnectFns.push(fn); }
  onMessage(fn: (c: ConnId, b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  send(conn: ConnId, bytes: Uint8Array, channel: Channel): void { const l = this.conns.get(conn); if (l) sendOn(l, bytes, channel, this.unreliableBufferLimit); }
  disconnect(conn: ConnId): void { const l = this.conns.get(conn); if (l) { this.drop(conn); l.close(); } }
  /** Graceful host shutdown: every guest gets the "bye" frame, then the links close. */
  close(): void { for (const [id, l] of [...this.conns]) { l.reliable.send(RTC_BYE); this.drop(id); l.close(); } }
  private drop(id: ConnId): void { if (this.conns.delete(id)) for (const f of this.disconnectFns) f(id); }
}
