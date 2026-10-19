/**
 * Player name table (milestone 7). Items, listings and stalls carry only u32 PlayerIds; display names come from core's
 * PlayerNameRegistry and are replicated to each client ONCE per id, on demand, then kept fresh: renames (registry change
 * log) are pushed to every client that has the id cached.
 *
 * Wire (reliable):
 *  NameReq (c->s): varuint n (<= 64), n x varuint playerId           client asks for ids it saw first-time
 *  Names   (s->c): varuint n, n x (varuint playerId, bit has, [varuint len, len bytes = core writeString(name)])
 *                  has = 0: no such name (removed / unknown); the client caches that too and is told if it appears.
 */
import { BinaryReader, BinaryWriter, readString, writeString, type PlayerNameRegistry } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { TokenBucket } from "./messages.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { NetServer } from "./server.js";

export const MAX_NAME_REQUEST = 64;
function encodeNames(entries: readonly [number, string | null][]): Uint8Array {
  const w = new BitWriter(); writeHeader(w, MsgType.Names); w.writeVarUint(entries.length);
  for (const [id, name] of entries) {
    w.writeVarUint(id); w.writeBool(name !== null);
    if (name !== null) { const b = new BinaryWriter(16); writeString(b, name, 64); const bytes = b.finish(); w.writeVarUint(bytes.length); w.writeBytes(bytes); }
  }
  return w.finish();
}

export interface NameSyncOptions {
  names: PlayerNameRegistry;
  /** NameReq messages per second per client (default 10/s, burst 20). */
  rate?: { perSec: number; burst: number };
}
/** Server side: `new NameSync(server, { names })`. */
export class NameSync {
  private known = new Map<number, Set<number>>(); // clientId -> ids it caches
  private seq: number;
  private buckets = new Map<number, TokenBucket>();
  readonly stats = { sent: 0, renamesPushed: 0, resyncs: 0, bytes: 0 };
  constructor(readonly server: NetServer, readonly opts: NameSyncOptions) {
    this.seq = opts.names.seq;
    server.onRawMessage(MsgType.NameReq, (s, r) => {
      let b = this.buckets.get(s.clientId); if (!b) this.buckets.set(s.clientId, (b = new TokenBucket(opts.rate ?? { perSec: 10, burst: 20 })));
      if (!b.take()) { server.anomaly(s, "nameReqRateLimited"); return; }
      const n = r.readVarUint(); if (n > MAX_NAME_REQUEST) { server.anomaly(s, "malformed", "nameReq too long"); return; }
      const ids: number[] = []; for (let i = 0; i < n; i++) ids.push(r.readVarUint());
      this.push(s.clientId, ids);
    });
    server.onTick(() => this.tick());
  }
  /** Send names for ids the client doesn't have yet (server-initiated, e.g. alongside a sale event). */
  push(clientId: number, ids: Iterable<number>): void {
    let k = this.known.get(clientId); if (!k) this.known.set(clientId, (k = new Set()));
    const out: [number, string | null][] = [];
    for (const id of ids) { if (!id || k.has(id)) continue; k.add(id); out.push([id, this.opts.names.get(id) ?? null]); }
    if (out.length) this.send(clientId, out);
  }
  private send(clientId: number, out: [number, string | null][]): void {
    const b = encodeNames(out); this.stats.sent += out.length; this.stats.bytes += b.length; this.server.sendRaw(clientId, b, "reliable");
  }
  private tick(): void {
    for (const c of this.known.keys()) if (!this.server.sessions.get(c)?.conn) { this.known.delete(c); this.buckets.delete(c); }
    const dt = 1 / this.server.tickHz; for (const b of this.buckets.values()) b.refill(dt);
    const reg = this.opts.names; if (reg.seq === this.seq) return;
    const ch = reg.changesSince(this.seq); this.seq = reg.seq;
    if (!ch) { // log overrun: resend every cached id
      this.stats.resyncs++;
      for (const [c, k] of this.known) this.send(c, [...k].map((id) => [id, reg.get(id) ?? null]));
      return;
    }
    const last = new Map<number, string | null>(); for (const c of ch) last.set(c.player, c.name);
    for (const [c, k] of this.known) {
      const out: [number, string | null][] = []; for (const [id, name] of last) if (k.has(id)) out.push([id, name]);
      if (out.length) { this.stats.renamesPushed += out.length; this.send(c, out); }
    }
  }
}

/** Client side: `client.names`. get() returns the cached name, or undefined and requests it (batched). */
export class NamesClient {
  private cache = new Map<number, string | null>();
  private requested = new Set<number>();
  private queue: number[] = []; private scheduled = false;
  private handlers: ((id: number, name: string | null) => void)[] = [];
  constructor(private readonly client: { sendRaw(b: Uint8Array, ch: "reliable" | "unreliable"): boolean; onRawMessage(type: number, fn: (r: BitReader) => void): void }) {
    client.onRawMessage(MsgType.Names, (r) => {
      const n = r.readVarUint();
      for (let i = 0; i < n; i++) {
        const id = r.readVarUint(); const name = r.readBool() ? readString(new BinaryReader(r.readBytes(r.readVarUint())), 64) : null;
        this.requested.delete(id); this.cache.set(id, name); for (const f of this.handlers) f(id, name);
      }
    });
  }
  /** Display name, or undefined while unknown (requested automatically; listen with on()). 0 -> undefined. */
  get(id: number): string | undefined {
    if (!id) return undefined; const c = this.cache.get(id);
    if (c !== undefined) return c ?? undefined;
    this.want([id]); return undefined;
  }
  /** UI helper: name, or "#id" until it arrives. */
  display(id: number): string { return id ? this.get(id) ?? `#${id}` : ""; }
  has(id: number): boolean { return this.cache.has(id); }
  /** Prefetch ids (e.g. every crafterId in a listing panel). */
  want(ids: Iterable<number>): void {
    for (const id of ids) if (id && !this.cache.has(id) && !this.requested.has(id)) { this.requested.add(id); this.queue.push(id); }
    if (this.queue.length && !this.scheduled) { this.scheduled = true; queueMicrotask(() => this.flush()); }
  }
  /** Name arrived or changed (rename). */
  on(fn: (id: number, name: string | null) => void): () => void { this.handlers.push(fn); return () => { const i = this.handlers.indexOf(fn); if (i >= 0) this.handlers.splice(i, 1); }; }
  /** Connection reset: the server forgets what we cache, so drop it (names are re-requested on demand). */
  reset(): void { this.cache.clear(); this.requested.clear(); this.queue.length = 0; }
  private flush(): void {
    this.scheduled = false;
    while (this.queue.length) {
      const ids = this.queue.splice(0, MAX_NAME_REQUEST);
      const w = new BitWriter(); writeHeader(w, MsgType.NameReq); w.writeVarUint(ids.length); for (const id of ids) w.writeVarUint(id);
      if (!this.client.sendRaw(w.finish(), "reliable")) { for (const id of ids) this.requested.delete(id); }
    }
  }
}
