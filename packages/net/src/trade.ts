/**
 * Two-party trade session protocol (net owns the state machine and messages; gameplay owns the rules).
 *
 * Item model: inventory slots are parallel arrays item/count/durability u16[16] + createdTick u32[16]; no instance ids.
 * Offers reference slot indices + counts; the server snapshots the slot tuple at offer time and commit re-validates that
 * each slot still holds exactly that tuple with at least the offered count. The swap itself goes through
 * TradeInventory.swap, which must be atomic. coreTradeInventory() implements TradeInventory over core's atomic container
 * transfer + transaction log.
 *
 * Flow: Request -> (target) Accept | Decline -> Open: Offer* / Lock / Confirm(version) -> commit when both confirmed.
 * Any offer change bumps `version` and clears both locks and confirms. Confirm carries the version the client saw, so a
 * confirm against a stale offer is ignored. One active trade (requested or open) per client. Timeouts, distance, death
 * (entity gone), disconnect and the gameplay validate hook cancel.
 *
 * Wire (reliable, MsgType.Trade). client -> server: u8 op, then
 *   Request: varuint targetPlayer | Accept/Decline/Lock/Cancel: varuint tradeId | Confirm: varuint tradeId, varuint version
 *   Offer: varuint tradeId, u8 n, n x (u8 slot, u16 count)
 * server -> client: State
 *   varuint tradeId, varuint partnerPlayer, u8 status (TradeStatus), u8 reason (TradeEnd, 0 while active), bit iRequested,
 *   varuint version, varuint myOfferRevision, varuint theirOfferRevision (per side, +1 on every offer change by that side),
 *   bits myLock, myConfirm, theirLock, theirConfirm,
 *   myOffer, theirOffer: u8 n, n x (u8 slot, u16 item, u16 count, u16 durability, u32 createdTick)
 */
import { Transform, type Entity, type World } from "@engine/core";
import { Containers, transaction, type TxResult } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { ClientSession, NetServer } from "./server.js";

export const TradeOp = { Request: 0, Accept: 1, Decline: 2, Offer: 3, Lock: 4, Confirm: 5, Cancel: 6 } as const;
export const TradeStatus = { Requested: 0, Open: 1, Done: 2, Cancelled: 3 } as const;
export const TradeEnd = {
  None: 0, Declined: 1, Timeout: 2, Distance: 3, Dead: 4, Disconnect: 5, Busy: 6, Validation: 7, Cancelled: 8, NoTarget: 9, SwapFailed: 10,
  /** gameplay validate-hook reasons are sent as Hook + code */ Hook: 100,
} as const;
export interface SlotTuple { item: number; count: number; durability: number; createdTick: number }
export interface TradeOfferLine { slot: number; count: number }
export interface OfferedLine extends SlotTuple { slot: number /* count = offered count */ }
/** Inventory adapter (gameplay/core). */
export interface TradeInventory {
  readSlot(world: World, entity: Entity, slot: number): SlotTuple | undefined;
  /** Atomically move a's lines to b and b's lines to a (whole tuples, counts as offered). All-or-nothing; false = nothing changed. */
  swap(world: World, a: { entity: Entity; lines: readonly OfferedLine[] }, b: { entity: Entity; lines: readonly OfferedLine[] }, txnId: number): boolean;
}
export interface TradeServerOptions {
  inventory: TradeInventory;
  /** Gameplay rules (range, tradeable items, not in combat...). Return a code (sent as TradeEnd.Hook + code) to refuse/cancel. */
  validate?: (world: World, a: Entity, b: Entity, phase: "request" | "offer" | "commit" | "tick", offers?: readonly [readonly OfferedLine[], readonly OfferedLine[]]) => number | undefined;
  /** Max distance (tiles) between traders' owned entities (default 6). */
  maxDistance?: number;
  requestTimeoutTicks?: number; // default 30 s
  /** Idle timeout of an open trade (default 120 s since last change). */
  idleTimeoutTicks?: number;
  maxLines?: number; // default 16
  playerIdOf?: (s: ClientSession) => number;
  /** Trading entity of a client (default first owned entity with Transform). */
  entityOf?: (clientId: number) => Entity | undefined;
  onCommit?: (t: TradeInfo, txnId: number) => void;
  onEnd?: (t: TradeInfo, reason: number) => void;
}
export interface TradeInfo { id: number; a: number; b: number; status: number; version: number; revisions: [number, number]; offers: [OfferedLine[], OfferedLine[]]; locked: [boolean, boolean]; confirmed: [boolean, boolean] }

export class TradeServer {
  private trades = new Map<number, TradeInfo & { lastChange: number; startTick: number }>();
  private byClient = new Map<number, number>();
  private nextId = 1; private nextTxn = 1;
  readonly stats = { commits: 0, cancels: 0 };
  constructor(readonly server: NetServer, readonly opts: TradeServerOptions) {
    server.onRawMessage(MsgType.Trade, (s, r) => this.onMessage(s, r));
    server.onTick(() => this.tick());
  }
  get(id: number): TradeInfo | undefined { return this.trades.get(id); }
  activeTradeOf(clientId: number): TradeInfo | undefined { const id = this.byClient.get(clientId); return id === undefined ? undefined : this.trades.get(id); }
  private playerOf(clientId: number): number { const s = this.server.sessions.get(clientId); return s && this.opts.playerIdOf ? this.opts.playerIdOf(s) : clientId; }
  private entityOf(clientId: number): Entity | undefined {
    if (this.opts.entityOf) return this.opts.entityOf(clientId);
    const w = this.server.world; for (const e of this.server.ownedEntities(clientId)) if (w.isAlive(e) && w.has(e, Transform)) return e;
    return undefined;
  }
  private dist(a: Entity, b: Entity): number { const w = this.server.world; const p = w.get(a, Transform)!, q = w.get(b, Transform)!; return Math.hypot(p.x - q.x, p.y - q.y); }

  private onMessage(s: ClientSession, r: BitReader): void {
    const op = r.readBits(8); const me = s.clientId;
    if (op === TradeOp.Request) {
      const targetPlayer = r.readVarUint();
      const target = [...this.server.connected()].find((x) => this.playerOf(x.clientId) === targetPlayer && x.clientId !== me);
      const fail = (reason: number): void => this.sendEnded(me, 0, targetPlayer, reason);
      if (!target) return fail(TradeEnd.NoTarget);
      if (this.byClient.has(me) || this.byClient.has(target.clientId)) return fail(TradeEnd.Busy);
      const ea = this.entityOf(me), eb = this.entityOf(target.clientId);
      if (ea === undefined || eb === undefined) return fail(TradeEnd.Dead);
      if (this.dist(ea, eb) > (this.opts.maxDistance ?? 6)) return fail(TradeEnd.Distance);
      const h = this.opts.validate?.(this.server.world, ea, eb, "request"); if (h !== undefined) return fail(TradeEnd.Hook + h);
      const t = { id: this.nextId++, a: me, b: target.clientId, status: TradeStatus.Requested as number, version: 0, revisions: [0, 0] as [number, number], offers: [[], []] as [OfferedLine[], OfferedLine[]],
        locked: [false, false] as [boolean, boolean], confirmed: [false, false] as [boolean, boolean], lastChange: this.server.world.tick, startTick: this.server.world.tick };
      this.trades.set(t.id, t); this.byClient.set(me, t.id); this.byClient.set(target.clientId, t.id);
      this.broadcast(t); return;
    }
    const id = r.readVarUint(); const t = this.trades.get(id);
    if (!t || (t.a !== me && t.b !== me)) return;
    const side = t.a === me ? 0 : 1;
    if (op === TradeOp.Cancel) return this.end(t, TradeEnd.Cancelled);
    if (op === TradeOp.Decline) { if (t.status === TradeStatus.Requested && side === 1) this.end(t, TradeEnd.Declined); return; }
    if (op === TradeOp.Accept) { if (t.status === TradeStatus.Requested && side === 1) { t.status = TradeStatus.Open; t.lastChange = this.server.world.tick; this.broadcast(t); } return; }
    if (t.status !== TradeStatus.Open) return;
    if (op === TradeOp.Offer) {
      const n = r.readBits(8); const lines: TradeOfferLine[] = [];
      for (let i = 0; i < n; i++) lines.push({ slot: r.readBits(8), count: r.readBits(16) });
      const e = this.entityOf(me); if (e === undefined) return this.end(t, TradeEnd.Dead);
      const out: OfferedLine[] = []; const used = new Set<number>();
      if (n > (this.opts.maxLines ?? 16)) return this.server.anomaly(s, "tradeOffer", "too many lines");
      for (const l of lines) {
        const tup = this.opts.inventory.readSlot(this.server.world, e, l.slot);
        if (!tup || tup.item === 0 || l.count < 1 || l.count > tup.count || used.has(l.slot)) { this.server.anomaly(s, "tradeOffer", `slot ${l.slot}`); return this.broadcast(t); }
        used.add(l.slot); out.push({ slot: l.slot, item: tup.item, count: l.count, durability: tup.durability, createdTick: tup.createdTick });
      }
      const other = this.entityOf(side === 0 ? t.b : t.a);
      const offers: [OfferedLine[], OfferedLine[]] = side === 0 ? [out, t.offers[1]] : [t.offers[0], out];
      const h = other === undefined ? undefined : this.opts.validate?.(this.server.world, this.entityOf(t.a)!, this.entityOf(t.b)!, "offer", offers);
      if (h !== undefined) { this.sendState(me, t); return; } // refused offer: keep the old one
      t.offers[side] = out; t.version++; t.revisions[side]++; t.locked = [false, false]; t.confirmed = [false, false]; t.lastChange = this.server.world.tick;
      return this.broadcast(t);
    }
    if (op === TradeOp.Lock) { t.locked[side] = true; t.lastChange = this.server.world.tick; return this.broadcast(t); }
    if (op === TradeOp.Confirm) {
      const version = r.readVarUint();
      if (version !== t.version || !t.locked[0] || !t.locked[1]) return this.sendState(me, t); // stale confirm: ignored
      t.confirmed[side] = true; t.lastChange = this.server.world.tick;
      if (t.confirmed[0] && t.confirmed[1]) return this.commit(t);
      return this.broadcast(t);
    }
  }

  private commit(t: TradeInfo): void {
    const w = this.server.world; const ea = this.entityOf(t.a), eb = this.entityOf(t.b);
    if (ea === undefined || eb === undefined) return this.end(t, TradeEnd.Dead);
    // re-validate: slots still hold exactly the offered tuples
    for (const [side, e] of [[0, ea], [1, eb]] as const) for (const l of t.offers[side]) {
      const tup = this.opts.inventory.readSlot(w, e, l.slot);
      if (!tup || tup.item !== l.item || tup.durability !== l.durability || tup.createdTick !== l.createdTick || tup.count < l.count) return this.end(t, TradeEnd.Validation);
    }
    const h = this.opts.validate?.(w, ea, eb, "commit", t.offers); if (h !== undefined) return this.end(t, TradeEnd.Hook + h);
    const txn = this.nextTxn++;
    if (!this.opts.inventory.swap(w, { entity: ea, lines: t.offers[0] }, { entity: eb, lines: t.offers[1] }, txn)) return this.end(t, TradeEnd.SwapFailed);
    t.status = TradeStatus.Done; this.stats.commits++;
    this.opts.onCommit?.(t, txn);
    this.close(t, TradeEnd.None);
  }
  private end(t: TradeInfo, reason: number): void { t.status = TradeStatus.Cancelled; this.stats.cancels++; this.close(t, reason); }
  private close(t: TradeInfo, reason: number): void {
    this.trades.delete(t.id); if (this.byClient.get(t.a) === t.id) this.byClient.delete(t.a); if (this.byClient.get(t.b) === t.id) this.byClient.delete(t.b);
    this.opts.onEnd?.(t, reason);
    this.broadcast(t, reason);
  }
  private tick(): void {
    const w = this.server.world; const hz = this.server.tickHz;
    for (const t of [...this.trades.values()]) {
      const sa = this.server.sessions.get(t.a), sb = this.server.sessions.get(t.b);
      if (!sa?.conn || !sb?.conn) { this.end(t, TradeEnd.Disconnect); continue; }
      const ea = this.entityOf(t.a), eb = this.entityOf(t.b);
      if (ea === undefined || eb === undefined) { this.end(t, TradeEnd.Dead); continue; }
      if (this.dist(ea, eb) > (this.opts.maxDistance ?? 6)) { this.end(t, TradeEnd.Distance); continue; }
      const limit = t.status === TradeStatus.Requested ? (this.opts.requestTimeoutTicks ?? 30 * hz) : (this.opts.idleTimeoutTicks ?? 120 * hz);
      if (w.tick - t.lastChange > limit) { this.end(t, TradeEnd.Timeout); continue; }
      const h = this.opts.validate?.(w, ea, eb, "tick"); if (h !== undefined) this.end(t, TradeEnd.Hook + h);
    }
  }
  private writeLines(w: BitWriter, lines: readonly OfferedLine[]): void {
    w.writeBits(lines.length, 8);
    for (const l of lines) { w.writeBits(l.slot, 8); w.writeBits(l.item, 16); w.writeBits(l.count, 16); w.writeBits(l.durability, 16); w.writeBits(l.createdTick >>> 0, 32); }
  }
  private sendState(clientId: number, t: TradeInfo, reason = 0): void {
    const side = t.a === clientId ? 0 : 1; const o = 1 - side;
    const w = new BitWriter(); writeHeader(w, MsgType.Trade);
    w.writeVarUint(t.id); w.writeVarUint(this.playerOf(side === 0 ? t.b : t.a)); w.writeBits(t.status, 8); w.writeBits(reason, 8); w.writeBool(side === 0);
    w.writeVarUint(t.version); w.writeVarUint(t.revisions[side]!); w.writeVarUint(t.revisions[o]!); w.writeBool(t.locked[side]!); w.writeBool(t.confirmed[side]!); w.writeBool(t.locked[o]!); w.writeBool(t.confirmed[o]!);
    this.writeLines(w, t.offers[side]!); this.writeLines(w, t.offers[o]!);
    this.server.sendRaw(clientId, w.finish(), "reliable");
  }
  private sendEnded(clientId: number, id: number, partnerPlayer: number, reason: number): void {
    const w = new BitWriter(); writeHeader(w, MsgType.Trade);
    w.writeVarUint(id); w.writeVarUint(partnerPlayer); w.writeBits(TradeStatus.Cancelled, 8); w.writeBits(reason, 8); w.writeBool(true);
    w.writeVarUint(0); w.writeVarUint(0); w.writeVarUint(0); for (let i = 0; i < 4; i++) w.writeBool(false); w.writeBits(0, 8); w.writeBits(0, 8);
    this.server.sendRaw(clientId, w.finish(), "reliable");
  }
  private broadcast(t: TradeInfo, reason = 0): void { this.sendState(t.a, t, reason); this.sendState(t.b, t, reason); }
}

export interface TradeView {
  id: number; partner: number; status: number; reason: number; iRequested: boolean; version: number; myOfferRevision: number; theirOfferRevision: number;
  myLock: boolean; myConfirm: boolean; theirLock: boolean; theirConfirm: boolean; myOffer: OfferedLine[]; theirOffer: OfferedLine[];
}
/** Client side: `client.trade`. `current` = latest state of the active (or just-ended) trade. */
export class TradeClient {
  current: TradeView | undefined;
  private handlers: ((v: TradeView) => void)[] = [];
  constructor(private readonly client: { sendRaw(b: Uint8Array, ch: "reliable" | "unreliable"): boolean; onRawMessage(type: number, fn: (r: BitReader) => void): void }) {
    client.onRawMessage(MsgType.Trade, (r) => {
      const lines = (): OfferedLine[] => { const n = r.readBits(8); const o: OfferedLine[] = []; for (let i = 0; i < n; i++) o.push({ slot: r.readBits(8), item: r.readBits(16), count: r.readBits(16), durability: r.readBits(16), createdTick: r.readBits(32) }); return o; };
      const v: TradeView = { id: r.readVarUint(), partner: r.readVarUint(), status: r.readBits(8), reason: r.readBits(8), iRequested: r.readBool(), version: r.readVarUint(), myOfferRevision: r.readVarUint(), theirOfferRevision: r.readVarUint(),
        myLock: r.readBool(), myConfirm: r.readBool(), theirLock: r.readBool(), theirConfirm: r.readBool(), myOffer: lines(), theirOffer: lines() };
      this.current = v; for (const f of this.handlers) f(v);
    });
  }
  on(fn: (v: TradeView) => void): () => void { this.handlers.push(fn); return () => { const i = this.handlers.indexOf(fn); if (i >= 0) this.handlers.splice(i, 1); }; }
  private op(op: number, f?: (w: BitWriter) => void): boolean { const w = new BitWriter(); writeHeader(w, MsgType.Trade); w.writeBits(op, 8); f?.(w); return this.client.sendRaw(w.finish(), "reliable"); }
  request(targetPlayer: number): boolean { return this.op(TradeOp.Request, (w) => w.writeVarUint(targetPlayer)); }
  accept(id: number): boolean { return this.op(TradeOp.Accept, (w) => w.writeVarUint(id)); }
  decline(id: number): boolean { return this.op(TradeOp.Decline, (w) => w.writeVarUint(id)); }
  offer(id: number, lines: readonly TradeOfferLine[]): boolean { return this.op(TradeOp.Offer, (w) => { w.writeVarUint(id); w.writeBits(lines.length, 8); for (const l of lines) { w.writeBits(l.slot, 8); w.writeBits(l.count, 16); } }); }
  lock(id: number): boolean { return this.op(TradeOp.Lock, (w) => w.writeVarUint(id)); }
  /** Confirm the offer at `version` (from the latest state); the server ignores confirms against an older version. */
  confirm(id: number, version: number): boolean { return this.op(TradeOp.Confirm, (w) => { w.writeVarUint(id); w.writeVarUint(version); }); }
  cancel(id: number): boolean { return this.op(TradeOp.Cancel, (w) => w.writeVarUint(id)); }
}

/**
 * TradeInventory over core's Containers + transaction(): readSlot returns core Slot durability/createdTick (0 when the
 * container doesn't store them); swap moves every line into a free slot of the other side inside ONE core transaction
 * (validators run; core carries durability/createdTick through transfer; any failure rolls everything back). Needs
 * enough empty slots on each side (no merging, so tuples stay intact).
 */
export function coreTradeInventory(): TradeInventory {
  return {
    readSlot(world, e, slot) {
      const a = world.resource(Containers).adapterFor(world, e);
      if (!a || slot < 0 || slot >= a.capacity(world, e)) return undefined;
      const s = a.getSlot(world, e, slot); if (!s.item || s.count <= 0) return undefined;
      return { item: s.item, count: s.count, durability: s.durability ?? 0, createdTick: s.createdTick ?? 0 };
    },
    swap(world, a, b) {
      const reg = world.resource(Containers);
      const r = transaction(world, (tx) => {
        const reserved = new Map<Entity, Set<number>>();
        const move = (from: Entity, to: Entity, lines: readonly OfferedLine[]): TxResult => {
          const cap = reg.adapterFor(world, to)?.capacity(world, to) ?? 0;
          let res = reserved.get(to); if (!res) reserved.set(to, (res = new Set()));
          for (const l of lines) {
            let dst = -1; for (let i = 0; i < cap; i++) if (!res.has(i) && tx.get(to, i).item === 0) { dst = i; break; }
            if (dst < 0) return { ok: false, reason: "no_space" };
            res.add(dst); const t = tx.transfer(from, l.slot, to, dst, l.count); if (!t.ok) return t;
          }
          return { ok: true };
        };
        const x = move(a.entity, b.entity, a.lines); return x.ok ? move(b.entity, a.entity, b.lines) : x;
      });
      return r.ok;
    },
  };
}
