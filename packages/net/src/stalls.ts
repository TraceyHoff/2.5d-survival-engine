/**
 * Trade stalls (milestone 7). Split (locked with gameplay):
 *  - gameplay owns StallHeader {ownerKind, ownerId, open, listingCount} (scope "all", AOI) and Listings (with a
 *    revision, viewers scope), placement, permissions (core can(), OwnedBy, Membership, clan ranks) and every rule;
 *  - net replicates those components with its normal machinery (element-level deltas = per-listing deltas) and owns
 *    the purchase / owner-command transport, the race-safe price+stock check, the atomic core-transaction swap helper,
 *    results to the requester and sale notifications (queued for offline owners).
 *
 * Wire: MsgType.Stall (reliable), u4 op first.
 *  c->s  0 Buy       varuint req, varuint stallNetId, varuint listingId, varuint expectedRevision, varuint priceItem, varuint priceCount, varuint qty
 *        1 List      varuint req, varuint stallNetId, varuint slot, varuint priceItem, varuint priceCount
 *        2 EditPrice varuint req, varuint stallNetId, varuint listingId, varuint priceItem, varuint priceCount
 *        3 Delist    varuint req, varuint stallNetId, varuint listingId
 *        4 Collect   varuint req, varuint stallNetId
 *  s->c  8 Result    varuint req, u4 op, u8 reason (StallResult; 0 ok), varuint detail (buy: qty; list: listingId; collect: items)
 *        9 Sale      varuint stallNetId, varuint listingId, varuint item, varuint qty, varuint crafterId, varuint priceItem,
 *                    varuint priceTotal, varuint buyerId, u32 tick, bit queued (delivered after the owner came online), varuint dropped
 */
import { Containers, OwnedBy, Transform, TradeStall, buyFromStall, getStallListing, sameStack, stallRevision, transaction, type Entity, type World } from "@engine/core";
import { BitWriter, type BitReader } from "./bits.js";
import { TokenBucket, type RateLimit } from "./messages.js";
import type { NameSync } from "./names.js";
import { MsgType, writeHeader } from "./protocol.js";
import type { ClientSession, NetServer } from "./server.js";

export const StallOp = { Buy: 0, List: 1, EditPrice: 2, Delist: 3, Collect: 4 } as const;
export type StallOp = (typeof StallOp)[keyof typeof StallOp];
export const StallResult = {
  Ok: 0, PriceChanged: 1, SoldOut: 2, NoFunds: 3, Denied: 4, Closed: 5, OutOfRange: 6, RateLimited: 7, NoStall: 8, TillFull: 9,
  NoSpace: 10, BadRequest: 11, Disconnected: 12, StaleListing: 13, /** gameplay codes are Hook + code */ Hook: 100,
} as const;
export const MAX_LISTINGS = 24; // clan_pavilion; stall_blanket 4, stall_cart 8, stall_booth 12 (gameplay data)
export interface Price { itemId: number; count: number }
export interface ListingView { listingId: number; slot: number; item: number; count: number; durability: number; crafterId: number; price: Price }
/** What gameplay exposes about a stall entity (read from its StallHeader / Listings / containers). */
export interface StallView {
  open: boolean; ownerKind: number; ownerId: number; revision: number;
  listing(listingId: number): ListingView | undefined;
  /** Stock container entity (listing.slot indexes it) and till container entity (proceeds). */
  stock: Entity; till: Entity;
}
export interface BuyRequest { listingId: number; expectedRevision: number; expectedPrice: Price; qty: number }

/**
 * Race-safe check gameplay calls for priceChanged / soldOut: the listing must still exist with >= qty units and the
 * exact expected price. A changed revision alone is not a failure (another listing changed); it only skips the fast path.
 */
export function checkListing(stall: Pick<StallView, "revision" | "listing">, req: BuyRequest): number | undefined {
  if (!(req.qty >= 1)) return StallResult.BadRequest;
  const l = stall.listing(req.listingId);
  if (!l || l.item === 0 || l.count < req.qty) return StallResult.SoldOut;
  if (l.price.itemId !== req.expectedPrice.itemId || l.price.count !== req.expectedPrice.count) return StallResult.PriceChanged;
  return undefined;
}

/**
 * Atomic purchase in ONE core transaction: buyer pays price x qty (NoFunds), goods move stock[slot] -> buyer by core
 * transfer (crafterId, durability, createdTick preserved; merges only onto an identical stack, else an empty slot;
 * NoSpace), proceeds go into the till (TillFull). Any failure rolls everything back. Returns undefined on success.
 */
export function purchaseSwap(world: World, o: { buyer: Entity; stock: Entity; slot: number; qty: number; till: Entity; price: Price; item: number }): number | undefined {
  const reg = world.resource(Containers); let reason: number | undefined;
  const r = transaction(world, (tx) => {
    const src = tx.get(o.stock, o.slot);
    if (src.item !== o.item || src.count < o.qty) { reason = StallResult.SoldOut; return { ok: false, reason: "sold_out" }; }
    const total = o.price.count * o.qty;
    if (total > 0 && !tx.remove(o.buyer, o.price.itemId, total).ok) { reason = StallResult.NoFunds; return { ok: false, reason: "no_funds" }; }
    const cap = reg.adapterFor(world, o.buyer)?.capacity(world, o.buyer) ?? 0; let moved = false;
    for (const pass of [0, 1]) for (let i = 0; i < cap && !moved; i++) {
      const d = tx.get(o.buyer, i);
      if (pass === 0 ? !(d.item === src.item && sameStack(d, src)) : d.item !== 0) continue;
      if (tx.transfer(o.stock, o.slot, o.buyer, i, o.qty).ok) moved = true;
    }
    if (!moved) { reason = StallResult.NoSpace; return { ok: false, reason: "no_space" }; }
    if (total > 0 && !tx.add(o.till, o.price.itemId, total).ok) { reason = StallResult.TillFull; return { ok: false, reason: "till_full" }; }
    return { ok: true };
  });
  return r.ok ? undefined : (reason ?? StallResult.BadRequest);
}

/**
 * Pluggable purchase (gameplay supplies buyFromStall). Request as gameplay's PurchaseRequest, `listing` = wire listingId.
 * MUST be all-or-nothing (one core transaction): on any failure nothing moved. Return undefined / "" on success (or
 * `{ crafterId }`), else a reason string; STALL_BUY_REASONS map 1:1 to StallResult codes the client receives.
 */
export interface StallBuyRequest { listing: number; qty: number; expectedRevision: number; expectedPriceItem: number; expectedPriceCount: number }
export type StallBuyHook = (world: World, buyer: Entity, stall: Entity, req: StallBuyRequest) => string | undefined | { crafterId?: number; reason?: string };
export const STALL_BUY_REASONS: Readonly<Record<string, number>> = {
  sold_out: StallResult.SoldOut, no_funds: StallResult.NoFunds, price_changed: StallResult.PriceChanged, stale_listing: StallResult.StaleListing,
  forbidden: StallResult.Denied, no_space: StallResult.NoSpace, till_full: StallResult.TillFull,
  // other gameplay BUY_REASONS
  not_stall: StallResult.NoStall, stall_closed: StallResult.Closed, out_of_range: StallResult.OutOfRange,
  bad_listing: StallResult.SoldOut, listing_disabled: StallResult.SoldOut, bad_qty: StallResult.BadRequest,
};
/** Client-side name of a result code (inverse of STALL_BUY_REASONS for the seven buy reasons; "ok"; else undefined). */
export function stallReasonName(code: number): string | undefined {
  if (code === StallResult.Ok) return "ok";
  for (const k of ["sold_out", "no_funds", "price_changed", "stale_listing", "forbidden", "no_space", "till_full"]) if (STALL_BUY_REASONS[k] === code) return k;
  return undefined;
}

export interface SaleRecord { stallNetId: number; listingId: number; item: number; qty: number; crafterId: number; price: Price; buyerId: number; tick: number }
export interface OwnerCommand { op: StallOp; actor: Entity; stall: Entity; session: ClientSession; listingId?: number; slot?: number; price?: Price }
export interface StallHooks {
  /** Read the stall (undefined = not a stall). */
  view(world: World, stall: Entity): StallView | undefined;
  /** Buy permission (core can(); bans, faction rules). Default allow. */
  canBuy?(world: World, buyer: Entity, stall: Entity, session: ClientSession): boolean;
  /** Owner-op permission (owner, or clan member whose rank allows op). */
  canManage(world: World, actor: Entity, stall: Entity, op: StallOp, session: ClientSession): boolean;
  /** Perform list / editPrice / delist / collect (mutating Listings + revision). Return 0 ok, a StallResult, or Hook+code; detail optional. */
  owner(world: World, cmd: OwnerCommand): number | { reason: number; detail?: number };
  /** After a successful swap: gameplay updates the listing count/revision (and StallHeader.listingCount). */
  sold(world: World, stall: Entity, sale: SaleRecord): void;
  /** Persistent player ids to notify of a sale (owner; clan members with the right rank). */
  saleRecipients(world: World, stall: Entity, view: StallView): readonly number[];
  /** Full custom purchase (replaces checkListing + purchaseSwap); return 0 ok or a reason. */
  buy?(world: World, buyer: Entity, stall: Entity, view: StallView, req: BuyRequest): number | { reason: 0; crafterId?: number };
}
export interface StallServerOptions {
  hooks: StallHooks;
  /** Max buyer-stall distance in tiles (default 4). */
  range?: number;
  /** Requests per client (buy + owner ops), default 4/s burst 8. */
  rate?: RateLimit;
  /** Sales kept per offline recipient (default 32; older ones are counted as dropped). */
  offlineQueue?: number;
  /** Persistent player id of a session (default: group resolver playerOf, else clientId). */
  playerIdOf?: (s: ClientSession) => number;
  /** Pluggable purchase; same as setBuyHook(). Precedence: buy hook > hooks.buy > coreStallBuy (core TradeStall) > checkListing+purchaseSwap. */
  buyHook?: StallBuyHook;
  /** Push buyer/crafter names alongside sales. */
  names?: NameSync;
}

/** Server side: `new StallServer(server, { hooks })`. */
export class StallServer {
  private buckets = new Map<number, TokenBucket>();
  /** Undelivered sales per offline recipient playerId (persist these: see ARCHITECTURE §21). */
  readonly offline = new Map<number, { sales: SaleRecord[]; dropped: number }>();
  readonly stats = { buys: 0, sales: 0, rejected: new Map<number, number>(), queued: 0, delivered: 0 };
  readonly saleLog: ((s: SaleRecord, stall: Entity) => void)[] = [];
  private buyHook: StallBuyHook | undefined;
  /** Register (or clear with undefined) the gameplay purchase. When set it is the default buy path. */
  setBuyHook(fn: StallBuyHook | undefined): void { this.buyHook = fn; }
  constructor(readonly server: NetServer, readonly opts: StallServerOptions) {
    this.buyHook = opts.buyHook;
    server.onRawMessage(MsgType.Stall, (s, r) => this.onMessage(s, r));
    server.onTick(() => this.tick());
  }
  playerOf(s: ClientSession): number {
    if (this.opts.playerIdOf) return this.opts.playerIdOf(s);
    const g = this.server.groups as { playerOf?(c: number): number | undefined } | undefined;
    return g?.playerOf?.(s.clientId) ?? s.clientId;
  }
  private actor(s: ClientSession): Entity | undefined {
    const w = this.server.world; for (const e of this.server.ownedEntities(s.clientId)) if (w.isAlive(e) && w.has(e, Transform)) return e; return undefined;
  }
  private result(s: ClientSession, req: number, op: number, reason: number, detail = 0): void {
    if (reason) this.stats.rejected.set(reason, (this.stats.rejected.get(reason) ?? 0) + 1);
    const w = new BitWriter(); writeHeader(w, MsgType.Stall); w.writeBits(8, 4); w.writeVarUint(req); w.writeBits(op, 4); w.writeBits(reason, 8); w.writeVarUint(detail);
    this.server.sendRaw(s.clientId, w.finish(), "reliable");
  }
  private onMessage(s: ClientSession, r: BitReader): void {
    const op = r.readBits(4) as StallOp; const req = r.readVarUint(); const netId = r.readVarUint();
    const price = (): Price => ({ itemId: r.readVarUint(), count: r.readVarUint() });
    let listingId = 0, slot = 0, p: Price | undefined, rev = 0, qty = 0;
    switch (op) {
      case StallOp.Buy: listingId = r.readVarUint(); rev = r.readVarUint(); p = price(); qty = r.readVarUint(); break;
      case StallOp.List: slot = r.readVarUint(); p = price(); break;
      case StallOp.EditPrice: listingId = r.readVarUint(); p = price(); break;
      case StallOp.Delist: listingId = r.readVarUint(); break;
      case StallOp.Collect: break;
      default: this.server.anomaly(s, "malformed", `stall op ${op}`); return;
    }
    let b = this.buckets.get(s.clientId); if (!b) this.buckets.set(s.clientId, (b = new TokenBucket(this.opts.rate ?? { perSec: 4, burst: 8 })));
    if (!b.take()) { this.server.anomaly(s, "stallRateLimited"); return this.result(s, req, op, StallResult.RateLimited); }
    const w = this.server.world; const H = this.opts.hooks;
    const stall = this.server.netIds.entityOf(netId);
    const view = stall !== undefined && w.isAlive(stall) ? H.view(w, stall) : undefined;
    const actor = this.actor(s);
    if (stall === undefined || !view) return this.result(s, req, op, StallResult.NoStall);
    if (actor === undefined) return this.result(s, req, op, StallResult.Denied);
    const range = this.opts.range ?? 4;
    const at = w.get(actor, Transform)!, st = w.get(stall, Transform);
    if (!st || (at.x - st.x) ** 2 + (at.y - st.y) ** 2 > range * range) return this.result(s, req, op, StallResult.OutOfRange);
    if (op !== StallOp.Buy) {
      if (!H.canManage(w, actor, stall, op, s)) return this.result(s, req, op, StallResult.Denied);
      const res = H.owner(w, { op, actor, stall, session: s, listingId, slot, ...(p ? { price: p } : {}) });
      const o = typeof res === "number" ? { reason: res, detail: 0 } : res;
      return this.result(s, req, op, o.reason, o.detail ?? 0);
    }
    this.stats.buys++;
    if (!view.open) return this.result(s, req, op, StallResult.Closed);
    if (H.canBuy && !H.canBuy(w, actor, stall, s)) return this.result(s, req, op, StallResult.Denied);
    const breq: BuyRequest = { listingId, expectedRevision: rev, expectedPrice: p!, qty };
    let reason: number | undefined; let l: ListingView | undefined;
    let crafter: number | undefined;
    l = view.listing(listingId); // read before the swap: a sold-out listing may vanish
    if (this.buyHook) {
      const b = this.buyHook(w, actor, stall, { listing: listingId, qty, expectedRevision: rev, expectedPriceItem: p!.itemId, expectedPriceCount: p!.count });
      const why = typeof b === "object" ? b.reason : b;
      if (why) reason = STALL_BUY_REASONS[why] ?? StallResult.BadRequest; else if (typeof b === "object") crafter = b.crafterId;
    } else if (H.buy) { const b = H.buy(w, actor, stall, view, breq); if (typeof b === "number") reason = b || undefined; else crafter = b.crafterId; }
    else if (w.isRegistered(TradeStall) && w.has(stall, TradeStall)) { const b = coreStallBuy(w, actor, stall, view, breq); if (typeof b === "number") reason = b || undefined; else crafter = b.crafterId; }
    else {
      reason = checkListing(view, breq); l = view.listing(listingId);
      if (!reason) reason = purchaseSwap(w, { buyer: actor, stock: view.stock, slot: l!.slot, qty, till: view.till, price: l!.price, item: l!.item });
    }
    if (reason) return this.result(s, req, op, reason);
    l ??= view.listing(listingId);
    const sale: SaleRecord = { stallNetId: netId, listingId, item: l?.item ?? 0, qty, crafterId: crafter ?? l?.crafterId ?? 0, price: { itemId: p!.itemId, count: p!.count * qty }, buyerId: this.playerOf(s), tick: w.tick };
    H.sold(w, stall, sale); this.stats.sales++;
    this.result(s, req, op, StallResult.Ok, qty);
    for (const f of this.saleLog) f(sale, stall);
    this.notify(sale, H.saleRecipients(w, stall, view));
  }
  private online(): Map<number, number> {
    const m = new Map<number, number>(); for (const s of this.server.connected()) m.set(this.playerOf(s), s.clientId); return m;
  }
  private sendSale(clientId: number, sale: SaleRecord, queued: boolean, dropped = 0): void {
    const w = new BitWriter(); writeHeader(w, MsgType.Stall); w.writeBits(9, 4);
    for (const v of [sale.stallNetId, sale.listingId, sale.item, sale.qty, sale.crafterId, sale.price.itemId, sale.price.count, sale.buyerId]) w.writeVarUint(v);
    w.writeBits(sale.tick >>> 0, 32); w.writeBool(queued); w.writeVarUint(dropped);
    this.server.sendRaw(clientId, w.finish(), "reliable"); this.stats.delivered++;
    this.opts.names?.push(clientId, [sale.buyerId, sale.crafterId]);
  }
  /** Deliver a sale to recipients (online now, else queued). Exposed for gameplay-driven sales (e.g. auctions). */
  notify(sale: SaleRecord, recipients: readonly number[]): void {
    const on = this.online();
    for (const p of new Set(recipients)) {
      const c = on.get(p); if (c !== undefined) { this.sendSale(c, sale, false); continue; }
      let q = this.offline.get(p); if (!q) this.offline.set(p, (q = { sales: [], dropped: 0 }));
      q.sales.push(sale); this.stats.queued++;
      const cap = this.opts.offlineQueue ?? 32; if (q.sales.length > cap) { q.dropped += q.sales.length - cap; q.sales.splice(0, q.sales.length - cap); }
    }
  }
  private tick(): void {
    const dt = 1 / this.server.tickHz; for (const b of this.buckets.values()) b.refill(dt);
    for (const c of this.buckets.keys()) if (!this.server.sessions.get(c)?.conn) this.buckets.delete(c);
    if (!this.offline.size) return;
    const on = this.online();
    for (const [p, q] of this.offline) {
      const c = on.get(p); if (c === undefined) continue;
      q.sales.forEach((s, i) => this.sendSale(c, s, true, i === 0 ? q.dropped : 0)); this.offline.delete(p);
    }
  }
}

export interface StallResultMsg { req: number; op: StallOp; reason: number; detail: number }
export interface SaleMsg extends SaleRecord { queued: boolean; dropped: number }
/** Client side: `client.stalls`. Every request returns a Promise of its result (resolves with Disconnected on reset). */
export class StallClient {
  private nextReq = 1; private waiting = new Map<number, (r: StallResultMsg) => void>();
  private saleHandlers: ((s: SaleMsg) => void)[] = [];
  readonly sales: SaleMsg[] = [];
  constructor(private readonly client: { sendRaw(b: Uint8Array, ch: "reliable" | "unreliable"): boolean; onRawMessage(type: number, fn: (r: BitReader) => void): void }) {
    client.onRawMessage(MsgType.Stall, (r) => {
      const op = r.readBits(4);
      if (op === 8) {
        const m: StallResultMsg = { req: r.readVarUint(), op: r.readBits(4) as StallOp, reason: r.readBits(8), detail: r.readVarUint() };
        const f = this.waiting.get(m.req); this.waiting.delete(m.req); f?.(m); return;
      }
      if (op === 9) {
        const v = Array.from({ length: 8 }, () => r.readVarUint());
        const m: SaleMsg = { stallNetId: v[0]!, listingId: v[1]!, item: v[2]!, qty: v[3]!, crafterId: v[4]!, price: { itemId: v[5]!, count: v[6]! }, buyerId: v[7]!, tick: r.readBits(32), queued: r.readBool(), dropped: r.readVarUint() };
        this.sales.push(m); if (this.sales.length > 100) this.sales.shift();
        for (const f of this.saleHandlers) f(m);
      }
    });
  }
  private send(op: StallOp, stallNetId: number, fields: number[]): Promise<StallResultMsg> {
    const req = this.nextReq++;
    const w = new BitWriter(); writeHeader(w, MsgType.Stall); w.writeBits(op, 4); w.writeVarUint(req); w.writeVarUint(stallNetId); for (const f of fields) w.writeVarUint(f >>> 0);
    return new Promise((resolve) => {
      if (!this.client.sendRaw(w.finish(), "reliable")) return resolve({ req, op, reason: StallResult.Disconnected, detail: 0 });
      this.waiting.set(req, resolve);
    });
  }
  buy(stallNetId: number, listingId: number, expectedRevision: number, expectedPrice: Price, qty = 1): Promise<StallResultMsg> {
    return this.send(StallOp.Buy, stallNetId, [listingId, expectedRevision, expectedPrice.itemId, expectedPrice.count, qty]);
  }
  list(stallNetId: number, slot: number, price: Price): Promise<StallResultMsg> { return this.send(StallOp.List, stallNetId, [slot, price.itemId, price.count]); }
  editPrice(stallNetId: number, listingId: number, price: Price): Promise<StallResultMsg> { return this.send(StallOp.EditPrice, stallNetId, [listingId, price.itemId, price.count]); }
  delist(stallNetId: number, listingId: number): Promise<StallResultMsg> { return this.send(StallOp.Delist, stallNetId, [listingId]); }
  collect(stallNetId: number): Promise<StallResultMsg> { return this.send(StallOp.Collect, stallNetId, []); }
  onSale(fn: (s: SaleMsg) => void): () => void { this.saleHandlers.push(fn); return () => { const i = this.saleHandlers.indexOf(fn); if (i >= 0) this.saleHandlers.splice(i, 1); }; }
  /** Connection reset: outstanding requests resolve with Disconnected (the server may or may not have applied them). */
  reset(): void { for (const [req, f] of this.waiting) f({ req, op: StallOp.Buy, reason: StallResult.Disconnected, detail: 0 }); this.waiting.clear(); }
}

// ---- core TradeStall adapter (ADR-075: TradeStall + OwnedBy + stall stock container, buyFromStall) ----
/** listingId on the wire = core listing row + 1 (0 = none). Price = {currency, price} per bundle; count = bundles in stock. */
export function coreStallView(world: World, stall: Entity, opts: { open?: boolean } = {}): StallView | undefined {
  const own = world.get(stall, OwnedBy); if (!own || !world.has(stall, TradeStall)) return undefined;
  const reg = world.resource(Containers); const ad = reg.adapterFor(world, stall);
  const stockOf = (item: number): { n: number; crafter: number; dur: number } => {
    let n = 0, crafter = 0, dur = 0; const cap = ad?.capacity(world, stall) ?? 0;
    for (let i = 0; i < cap; i++) { const s = ad!.getSlot(world, stall, i); if (s.item !== item) continue; if (!n) { crafter = s.crafterId ?? 0; dur = s.durability ?? 0; } n += s.count; }
    return { n, crafter, dur };
  };
  return {
    open: opts.open ?? true, ownerKind: own.groupId ? 1 : 0, ownerId: own.groupId || own.playerId, revision: stallRevision(world, stall), stock: stall, till: stall,
    listing: (id) => {
      const l = getStallListing(world, stall, id - 1); if (!l) return undefined; const st = stockOf(l.item);
      return { listingId: id, slot: id - 1, item: l.item, count: Math.floor(st.n / l.qty), durability: st.dur, crafterId: st.crafter, price: { itemId: l.currency, count: l.price } };
    },
  };
}
const CORE_BUY: Record<string, number> = {
  not_stall: StallResult.NoStall, no_listing: StallResult.SoldOut, out_of_stock: StallResult.SoldOut, insufficient_funds: StallResult.NoFunds,
  denied: StallResult.Denied, stall_full: StallResult.TillFull, buyer_full: StallResult.NoSpace, bad_qty: StallResult.BadRequest,
};
/**
 * Map a core buyFromStall reason to a client result. stale_revision is resolved against the current listing: gone or not
 * enough stock -> SoldOut, else PriceChanged (the stall changed since the client's view: refresh and retry).
 */
export function mapCoreBuyReason(world: World, stall: Entity, listingId: number, reason: string): number {
  if (reason !== "stale_revision") return CORE_BUY[reason] ?? StallResult.BadRequest;
  const v = coreStallView(world, stall); const l = v?.listing(listingId);
  return !l || l.count < 1 ? StallResult.SoldOut : StallResult.PriceChanged;
}
/** hooks.buy over core buyFromStall (one bundle per request; qty must be 1), revision-checked with expectRevision. */
export function coreStallBuy(world: World, buyer: Entity, stall: Entity, _view: StallView, req: BuyRequest): number | { reason: 0; crafterId: number } {
  if (req.qty !== 1) return StallResult.BadRequest;
  const l = getStallListing(world, stall, req.listingId - 1); if (!l) return StallResult.SoldOut;
  if (l.currency !== req.expectedPrice.itemId || l.price !== req.expectedPrice.count) return StallResult.PriceChanged;
  const r = buyFromStall(world, buyer, stall, req.listingId - 1, { expectRevision: req.expectedRevision });
  if (!r.ok) return mapCoreBuyReason(world, stall, req.listingId, r.reason);
  return { reason: 0, crafterId: r.sale.crafterIds[0] ?? 0 };
}
