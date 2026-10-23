/**
 * Character appearance transport (core Appearance, ADR-080; docs/CHARACTER_CUSTOMIZATION.md).
 *
 * Replication: Appearance is a networked component (scope "all" by default) and goes through normal snapshots /
 * deltas; this module only carries the client's REQUEST to change it. Every write goes through core's
 * `setAppearance` (sole writer, bumps `version`); validation is core's `validateAppearance` in reject mode with the
 * player's unlock tags.
 *
 * Wire: MsgType.Appearance (reliable), u2 kind.
 *   C->S kind 0 set / 1 initial (first join): varuint req, value
 *   S->C kind 2 result: varuint req, u8 AppearanceResult, varuint len + utf8 first issue ("" when ok)
 *   value = varuint bodyType, varuint skinTone, varuint n, n x (varuint part, varuint primary, varuint secondary)
 * The slot count travels on the wire (no hardcoded layout); the server rejects n > SLOT_COUNT and pads missing slots
 * with 0. `version` is never sent by clients.
 */
import { SLOT_COUNT, setAppearance, validateAppearance, type AppearanceValue, type CosmeticCatalogLike, type Entity, type World } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { MsgType, writeHeader } from "./protocol.js";
import { TokenBucket, type RateLimit } from "./messages.js";
import type { ClientSession, NetServer } from "./server.js";

export const AppearanceResult = { Ok: 0, RateLimited: 1, Invalid: 2, Denied: 3, NoEntity: 4, Malformed: 5, Disconnected: 6 } as const;
export type AppearanceResult = (typeof AppearanceResult)[keyof typeof AppearanceResult];
export interface AppearanceResultMsg { req: number; result: AppearanceResult; issue: string }
const te = new TextEncoder(); const td = new TextDecoder();
const MAX_ISSUE = 200;

function writeValue(w: BitWriter, v: AppearanceValue): void {
  w.writeVarUint(v.bodyType >>> 0); w.writeVarUint(v.skinTone >>> 0); const n = v.parts.length; w.writeVarUint(n);
  for (let i = 0; i < n; i++) { w.writeVarUint((v.parts[i] ?? 0) >>> 0); w.writeVarUint((v.primary[i] ?? 0) >>> 0); w.writeVarUint((v.secondary[i] ?? 0) >>> 0); }
}
function readValue(r: BitReader): AppearanceValue | undefined {
  const bodyType = r.readVarUint(), skinTone = r.readVarUint(), n = r.readVarUint(); if (n > SLOT_COUNT) return undefined;
  const parts: number[] = [], primary: number[] = [], secondary: number[] = [];
  for (let i = 0; i < n; i++) { parts.push(r.readVarUint()); primary.push(r.readVarUint()); secondary.push(r.readVarUint()); }
  for (let i = n; i < SLOT_COUNT; i++) { parts.push(0); primary.push(0); secondary.push(0); }
  return { bodyType, skinTone, parts, primary, secondary };
}

export interface AppearanceServerOptions {
  catalog: CosmeticCatalogLike;
  /** The player's unlock tags (gameplay stores them per player). */
  unlocksOf: (s: ClientSession, e: Entity) => ReadonlySet<string>;
  /**
   * Game rule gate. `initial` = the join-time look. Default: initial allowed once per session, later changes allowed
   * (gameplay should restrict them to mirror / barber stations).
   */
  allow?: (s: ClientSession, e: Entity, initial: boolean, world: World) => boolean;
  /** Entity the session customizes (default: its first owned entity). */
  entityOf?: (s: ClientSession) => Entity | undefined;
  /** Changes per client, default 0.5/s burst 3 (initial included). */
  rate?: RateLimit;
  /** After a successful write (mark the player record dirty, log). */
  onChanged?: (s: ClientSession, e: Entity, value: AppearanceValue, version: number) => void;
  /** Initial look received before the player entity exists: kept this many ticks (default 200). */
  pendingTicks?: number;
}

/** Server side: `new AppearanceServer(server, { catalog, unlocksOf })`. */
export class AppearanceServer {
  private buckets = new Map<number, TokenBucket>();
  private initialDone = new Set<number>();
  private pending = new Map<number, { req: number; value: AppearanceValue; ttl: number }>();
  readonly stats = { applied: 0, rejected: new Map<number, number>() };
  constructor(readonly server: NetServer, readonly opts: AppearanceServerOptions) {
    server.onRawMessage(MsgType.Appearance, (s, r) => this.onMessage(s, r));
    // input phase, not onTick: tick hooks run after capture, and step() clears change bits, so writes there would never replicate
    server.world.addSystem("input", "net.appearance", () => this.tick());
  }
  private entity(s: ClientSession): Entity | undefined {
    if (this.opts.entityOf) return this.opts.entityOf(s);
    const w = this.server.world; for (const e of this.server.ownedEntities(s.clientId)) if (w.isAlive(e)) return e; return undefined;
  }
  private reply(s: ClientSession, req: number, result: AppearanceResult, issue = ""): void {
    if (result) this.stats.rejected.set(result, (this.stats.rejected.get(result) ?? 0) + 1);
    const w = new BitWriter(); writeHeader(w, MsgType.Appearance); w.writeBits(2, 2); w.writeVarUint(req); w.writeBits(result, 8);
    const b = te.encode(issue.slice(0, MAX_ISSUE)); w.writeVarUint(b.length); w.writeBytes(b);
    this.server.sendRaw(s.clientId, w.finish(), "reliable");
  }
  private onMessage(s: ClientSession, r: BitReader): void {
    const kind = r.readBits(2); const req = r.readVarUint();
    if (kind > 1) { this.server.anomaly(s, "malformed", `appearance kind ${kind}`); return; }
    const value = readValue(r); if (!value) { this.server.anomaly(s, "malformed", "appearance slots"); return this.reply(s, req, AppearanceResult.Malformed); }
    let b = this.buckets.get(s.clientId); if (!b) this.buckets.set(s.clientId, (b = new TokenBucket(this.opts.rate ?? { perSec: 0.5, burst: 3 })));
    if (!b.take()) { this.server.anomaly(s, "appearanceRateLimited"); return this.reply(s, req, AppearanceResult.RateLimited); }
    const initial = kind === 1;
    if (initial && this.initialDone.has(s.clientId)) return this.reply(s, req, AppearanceResult.Denied, "initial look already set");
    const e = this.entity(s);
    if (e === undefined) {
      if (initial) { this.pending.set(s.clientId, { req, value, ttl: this.opts.pendingTicks ?? 200 }); return; }
      return this.reply(s, req, AppearanceResult.NoEntity);
    }
    this.apply(s, e, req, value, initial);
  }
  private apply(s: ClientSession, e: Entity, req: number, value: AppearanceValue, initial: boolean): void {
    const w = this.server.world;
    const allowed = this.opts.allow ? this.opts.allow(s, e, initial, w) : true;
    if (!allowed) return this.reply(s, req, AppearanceResult.Denied);
    const v = validateAppearance(this.opts.catalog, value, { mode: "reject", unlocked: this.opts.unlocksOf(s, e) });
    if (!v.value) return this.reply(s, req, AppearanceResult.Invalid, v.issues[0] ?? "invalid");
    if (initial) this.initialDone.add(s.clientId);
    const version = setAppearance(w, e, v.value); this.stats.applied++;
    this.opts.onChanged?.(s, e, v.value, version);
    this.reply(s, req, AppearanceResult.Ok);
  }
  private tick(): void {
    const dt = 1 / this.server.tickHz; for (const b of this.buckets.values()) b.refill(dt);
    for (const c of [...this.buckets.keys()]) if (this.server.sessions.get(c)?.conn === undefined) { this.buckets.delete(c); this.initialDone.delete(c); this.pending.delete(c); }
    for (const [c, p] of this.pending) {
      const s = this.server.sessions.get(c); if (!s) { this.pending.delete(c); continue; }
      const e = this.entity(s);
      if (e !== undefined) { this.pending.delete(c); this.apply(s, e, p.req, p.value, true); }
      else if (--p.ttl <= 0) { this.pending.delete(c); this.reply(s, p.req, AppearanceResult.NoEntity); }
    }
  }
}

type RawClient = { sendRaw(b: Uint8Array, ch: "reliable" | "unreliable"): boolean; onRawMessage(type: number, fn: (r: BitReader) => void): void };
/** Client side (`client.appearance`). */
export class AppearanceClient {
  private nextReq = 1; private waiting = new Map<number, (m: AppearanceResultMsg) => void>();
  private initial: AppearanceValue | undefined;
  /** Result of the join-time look, once the server answered. */
  initialResult: AppearanceResultMsg | undefined;
  constructor(private readonly client: RawClient) {
    client.onRawMessage(MsgType.Appearance, (r) => {
      if (r.readBits(2) !== 2) return;
      const req = r.readVarUint(); const result = r.readBits(8) as AppearanceResult; const n = r.readVarUint(); const issue = td.decode(r.readBytes(Math.min(n, 4 * MAX_ISSUE)));
      const m = { req, result, issue }; const f = this.waiting.get(req); this.waiting.delete(req); f?.(m);
    });
  }
  /** Look chosen in the creator screen; sent automatically right after every successful join (welcome). */
  setInitial(v: AppearanceValue | undefined): void { this.initial = v; }
  private send(kind: 0 | 1, v: AppearanceValue): Promise<AppearanceResultMsg> {
    const req = this.nextReq++; const w = new BitWriter(); writeHeader(w, MsgType.Appearance); w.writeBits(kind, 2); w.writeVarUint(req); writeValue(w, v);
    return new Promise((resolve) => {
      if (!this.client.sendRaw(w.finish(), "reliable")) return resolve({ req, result: AppearanceResult.Disconnected, issue: "" });
      this.waiting.set(req, resolve);
    });
  }
  /** Request a change (server validates against unlocks; result arrives via the promise). */
  set(v: AppearanceValue): Promise<AppearanceResultMsg> { return this.send(0, v); }
  /** @internal called by NetClient on Welcome. */
  onWelcome(): void {
    for (const f of this.waiting.values()) f({ req: 0, result: AppearanceResult.Disconnected, issue: "" }); this.waiting.clear();
    if (this.initial) void this.send(1, this.initial).then((m) => { this.initialResult = m; });
  }
}
