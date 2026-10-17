/** Node-only: import via "@engine/net/node" so browser bundles never pull in `ws`. */
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { Channel, ConnId, ServerTransport } from "./types.js";

export class WsServerTransport implements ServerTransport {
  private wss: WebSocketServer | undefined;
  private conns = new Map<ConnId, WebSocket>();
  private nextId = 1;
  private connectFns: ((c: ConnId) => void)[] = [];
  private disconnectFns: ((c: ConnId) => void)[] = [];
  private messageFns: ((c: ConnId, b: Uint8Array, ch: Channel) => void)[] = [];
  constructor(private readonly unreliableBufferLimit = 64 * 1024) {}

  /** Resolves with the bound port (pass 0 for an ephemeral port). */
  listen(port: number, host = "127.0.0.1"): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host });
      this.wss = wss;
      wss.once("error", reject);
      wss.once("listening", () => resolve((wss.address() as AddressInfo).port));
      wss.on("connection", (ws) => {
        const id = this.nextId++; this.conns.set(id, ws);
        ws.on("message", (data: RawData) => {
          const buf = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
          const bytes = new Uint8Array(buf.byteLength); bytes.set(buf);
          for (const f of this.messageFns) f(id, bytes, "reliable");
        });
        ws.on("close", () => { if (this.conns.delete(id)) for (const f of this.disconnectFns) f(id); });
        for (const f of this.connectFns) f(id);
      });
    });
  }
  onConnect(fn: (c: ConnId) => void): void { this.connectFns.push(fn); }
  onDisconnect(fn: (c: ConnId) => void): void { this.disconnectFns.push(fn); }
  onMessage(fn: (c: ConnId, b: Uint8Array, ch: Channel) => void): void { this.messageFns.push(fn); }
  send(conn: ConnId, bytes: Uint8Array, channel: Channel): void {
    const ws = this.conns.get(conn); if (!ws || ws.readyState !== ws.OPEN) return;
    if (channel === "unreliable" && ws.bufferedAmount > this.unreliableBufferLimit) return;
    ws.send(bytes);
  }
  disconnect(conn: ConnId): void { this.conns.get(conn)?.close(); }
  close(): Promise<void> {
    for (const ws of this.conns.values()) ws.terminate();
    return new Promise((res) => { if (this.wss) this.wss.close(() => res()); else res(); });
  }
}
