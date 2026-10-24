import type { Channel, ConnId, ServerTransport } from "./types.js";

/**
 * Fans several ServerTransports into one (e.g. a P2P host's own loopback client + WebRTC guests) so a single
 * NetServer serves all of them with the same validation. ConnIds are remapped to be unique; `now` comes from the first.
 */
export class MultiServerTransport implements ServerTransport {
  private next = 1;
  private toInner = new Map<ConnId, { t: ServerTransport; c: ConnId }>();
  private toOuter: Map<ConnId, ConnId>[];
  private connectFns: ((c: ConnId) => void)[] = [];
  private disconnectFns: ((c: ConnId) => void)[] = [];
  private messageFns: ((c: ConnId, b: Uint8Array, ch: Channel) => void)[] = [];
  readonly now?: () => number;
  constructor(private readonly parts: readonly ServerTransport[]) {
    const first = parts[0]; if (first?.now) this.now = () => first.now!();
    this.toOuter = parts.map(() => new Map());
    parts.forEach((t, i) => {
      const map = this.toOuter[i]!;
      t.onConnect((c) => { const id = this.next++; map.set(c, id); this.toInner.set(id, { t, c }); for (const f of this.connectFns) f(id); });
      t.onDisconnect((c) => { const id = map.get(c); if (id === undefined) return; map.delete(c); this.toInner.delete(id); for (const f of this.disconnectFns) f(id); });
      t.onMessage((c, b, ch) => { const id = map.get(c); if (id !== undefined) for (const f of this.messageFns) f(id, b, ch); });
    });
  }
  onConnect(fn: (c: ConnId) => void): void { this.connectFns.push(fn); }
  onDisconnect(fn: (c: ConnId) => void): void { this.disconnectFns.push(fn); }
  onMessage(fn: (c: ConnId, b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  send(conn: ConnId, bytes: Uint8Array, channel: Channel): void { const x = this.toInner.get(conn); x?.t.send(x.c, bytes, channel); }
  disconnect(conn: ConnId): void { const x = this.toInner.get(conn); x?.t.disconnect(x.c); }
  close(): void { for (const t of this.parts) void t.close(); }
}
