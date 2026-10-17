import { Rng } from "@engine/core";
import type { Channel, ClientTransport, ConnId, ServerTransport } from "./types.js";

/** Simulated link conditions, applied per direction. Loss applies to the unreliable channel only. */
export interface LinkConditions { latencyMs?: number; jitterMs?: number; loss?: number }

interface Pending { at: number; seq: number; run: () => void }

/**
 * Deterministic in-memory network with a virtual clock. Nothing is delivered until `advance(ms)`.
 * Reliable traffic keeps send order (jitter never reorders it); unreliable traffic can reorder and drop.
 */
export class LoopbackNetwork {
  now = 0;
  private queue: Pending[] = [];
  private seq = 0;
  private readonly rng: Rng;
  server: LoopbackServerTransport | undefined;
  stats = { sent: 0, dropped: 0, delivered: 0, bytes: 0 };
  constructor(seed = 1) { this.rng = new Rng(seed); }

  createServer(): LoopbackServerTransport { this.server = new LoopbackServerTransport(this); return this.server; }
  createClient(conditions: LinkConditions = {}): LoopbackClientTransport { return new LoopbackClientTransport(this, conditions); }

  /** @internal */
  schedule(link: Link, ch: Channel, bytes: Uint8Array, deliver: (b: Uint8Array) => void): void {
    this.stats.sent++; this.stats.bytes += bytes.length;
    const c = link.conditions;
    if (ch === "unreliable" && (c.loss ?? 0) > 0 && this.rng.next() < c.loss!) { this.stats.dropped++; return; }
    let at = this.now + (c.latencyMs ?? 0) + (c.jitterMs ? this.rng.range(0, c.jitterMs) : 0);
    if (ch === "reliable") { at = Math.max(at, link.lastReliableAt); link.lastReliableAt = at; }
    const copy = bytes.slice();
    this.queue.push({ at, seq: this.seq++, run: () => { this.stats.delivered++; deliver(copy); } });
  }
  /** Advance virtual time, delivering everything due (including messages sent during delivery). */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const p = this.queue[i]!;
        if (p.at <= end && (best < 0 || p.at < this.queue[best]!.at || (p.at === this.queue[best]!.at && p.seq < this.queue[best]!.seq))) best = i;
      }
      if (best < 0) break;
      const p = this.queue.splice(best, 1)[0]!;
      this.now = Math.max(this.now, p.at);
      p.run();
    }
    this.now = end;
  }
}

/** @internal one direction of a connection */
export class Link { lastReliableAt = 0; constructor(readonly conditions: LinkConditions) {} }

export class LoopbackServerTransport implements ServerTransport {
  private nextId = 1;
  /** @internal */ clients = new Map<ConnId, LoopbackClientTransport>();
  private connectFns: ((c: ConnId) => void)[] = [];
  private disconnectFns: ((c: ConnId) => void)[] = [];
  private messageFns: ((c: ConnId, b: Uint8Array, ch: Channel) => void)[] = [];
  now(): number { return this.net.now; }
  constructor(private readonly net: LoopbackNetwork) {}
  onConnect(fn: (c: ConnId) => void): void { this.connectFns.push(fn); }
  onDisconnect(fn: (c: ConnId) => void): void { this.disconnectFns.push(fn); }
  onMessage(fn: (c: ConnId, b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  /** @internal */ attach(c: LoopbackClientTransport): ConnId {
    const id = this.nextId++; this.clients.set(id, c); for (const f of this.connectFns) f(id); return id;
  }
  /** @internal */ detach(id: ConnId): void { if (this.clients.delete(id)) for (const f of this.disconnectFns) f(id); }
  /** @internal */ receive(id: ConnId, b: Uint8Array, ch: Channel): void { if (this.clients.has(id)) for (const f of this.messageFns) f(id, b, ch); }
  send(conn: ConnId, bytes: Uint8Array, channel: Channel): void {
    const c = this.clients.get(conn); if (!c) return;
    this.net.schedule(c.down, channel, bytes, (b) => c.receive(b, channel));
  }
  disconnect(conn: ConnId): void { const c = this.clients.get(conn); if (c) c.close(); }
  close(): void { for (const c of [...this.clients.values()]) c.close(); }
}

export class LoopbackClientTransport implements ClientTransport {
  /** @internal */ readonly up: Link;
  /** @internal */ readonly down: Link;
  private conn: ConnId | undefined;
  private messageFns: ((b: Uint8Array, ch: Channel) => void)[] = [];
  private closeFns: (() => void)[] = [];
  constructor(private readonly net: LoopbackNetwork, conditions: LinkConditions) { this.up = new Link(conditions); this.down = new Link(conditions); }
  get connected(): boolean { return this.conn !== undefined; }
  connect(): Promise<void> {
    if (!this.net.server) return Promise.reject(new Error("loopback: no server"));
    this.conn = this.net.server.attach(this); return Promise.resolve();
  }
  send(bytes: Uint8Array, channel: Channel): void {
    const id = this.conn; if (id === undefined) return;
    this.net.schedule(this.up, channel, bytes, (b) => this.net.server?.receive(id, b, channel));
  }
  onMessage(fn: (b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  onClose(fn: () => void): void { this.closeFns.push(fn); }
  /** @internal */ receive(b: Uint8Array, ch: Channel): void { if (this.conn !== undefined) for (const f of this.messageFns) f(b, ch); }
  close(): void {
    const id = this.conn; if (id === undefined) return;
    this.conn = undefined; this.net.server?.detach(id); for (const f of this.closeFns) f();
  }
}
