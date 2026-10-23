import { defineComponent } from "./component.js";
import { entityIndex, type Entity } from "./entity.js";
import { defineResource, type World } from "./world.js";
import { can, playerOf } from "./permissions.js";
import { OwnedBy } from "./social.js";
import { transaction, type SlotExtras, type TxResult } from "./transactions.js";

/**
 * Trade stalls (ADR-075). Engine primitive only: no prices, taxes or balance rules.
 *  - A stall entity has TradeStall + OwnedBy (player and/or clan group) + any registered slot container (its stock).
 *  - Listings live in TradeStall (fixed STALL_LISTINGS rows: item def, qty per purchase, price, currency item def).
 *  - stockStall / withdrawStall / setStallListing go through core can() with gameplay-supplied action bits, so clan
 *    rank (policy.minRole), ACLs, claims and rules apply unchanged.
 *  - buyFromStall is one transaction(): buyer pays currency -> stall stock, item units (with crafterId/durability)
 *    -> buyer. Any failure rolls back everything. Successful sales append to the SaleLedger.
 *  - TradeStall.revision is bumped on every stock or listing change made through these functions; net uses it for
 *    revision-checked purchases (opts.expectRevision). Writing the stock container directly bypasses the bump.
 */
export const STALL_LISTINGS = 8;
export const TradeStall = defineComponent("TradeStall", {
  stallId: "u32", revision: "u32",
  listItem: { type: "u16", length: STALL_LISTINGS }, listQty: { type: "u16", length: STALL_LISTINGS },
  listPrice: { type: "u32", length: STALL_LISTINGS }, listCurrency: { type: "u16", length: STALL_LISTINGS },
}, { networked: true, persistent: true });

/**
 * Viewer-facing mirror of the TradeStall listing rows (ADR-081). Networked with no scope hook, so net broadcasts it to
 * every observer of the stall (TradeStall itself stays the authoritative row source). Slot i mirrors listing row i:
 * item (item def id, 0 = empty), qty (units per purchase), price, currency (item def id). Optional: setStallListing /
 * stockStall / withdrawStall / buyFromStall call syncStallDisplay when the stall entity has it.
 */
export const StallDisplay = defineComponent("StallDisplay", {
  item: { type: "u16", length: STALL_LISTINGS }, qty: { type: "u16", length: STALL_LISTINGS },
  price: { type: "u32", length: STALL_LISTINGS }, currency: { type: "u16", length: STALL_LISTINGS },
}, { networked: true });
/** Copies TradeStall listing rows into StallDisplay (no-op unless the entity has both). Marks changed only on a diff. Returns true if anything changed. */
export function syncStallDisplay(world: World, stall: Entity): boolean {
  if (!world.isRegistered(StallDisplay) || !world.has(stall, StallDisplay) || !world.has(stall, TradeStall)) return false;
  const pairs = [["listItem", "item"], ["listQty", "qty"], ["listPrice", "price"], ["listCurrency", "currency"]] as const; let changed = false;
  for (const [src, dst] of pairs) {
    const a = world.getArray(stall, TradeStall, src)!, b = world.getArray(stall, StallDisplay, dst)!;
    for (let i = 0; i < STALL_LISTINGS; i++) if (b[i] !== a[i]) { b[i] = a[i]!; changed = true; }
  }
  if (changed) world.store(StallDisplay).markChanged(entityIndex(stall));
  return changed;
}
/** Registers StallDisplay if needed, adds it to a stall and syncs it. */
export function addStallDisplay(world: World, stall: Entity): void {
  if (!world.isRegistered(StallDisplay)) world.register(StallDisplay);
  if (!world.has(stall, StallDisplay)) world.add(stall, StallDisplay, {});
  syncStallDisplay(world, stall);
}
export interface StallListing { item: number; qty: number; price: number; currency: number }
export interface StallActions { stock: number; withdraw: number; manage: number; /** 0 = anyone may buy */ buy?: number }
export interface SaleEntry {
  seq: number; tick: number; stallId: number; stall: Entity; listing: number;
  buyer: Entity; buyerPlayer: number; ownerPlayer: number; ownerGroup: number;
  item: number; qty: number; currency: number; price: number;
  /** crafterId per moved part (0 = none), in take order. */
  crafterIds: number[];
}
/** Append-only sale log. Survival consumes entriesSince(cursor); old entries beyond capacity are dropped from memory. */
export class SaleLedger {
  seq = 0;
  private log: SaleEntry[] = [];
  constructor(readonly capacity = 8192) {}
  append(e: Omit<SaleEntry, "seq">): SaleEntry {
    const x: SaleEntry = { ...e, seq: ++this.seq }; this.log.push(x);
    if (this.log.length > this.capacity) this.log.splice(0, this.log.length - this.capacity); return x;
  }
  /** Entries with seq > since; undefined if some were already dropped. */
  entriesSince(since: number): readonly SaleEntry[] | undefined {
    if (since >= this.seq) return [];
    const first = this.log[0]; if (!first || first.seq > since + 1) return undefined;
    return this.log.filter((e) => e.seq > since);
  }
}
export interface StallsRes { actions: StallActions; ledger: SaleLedger; nextStallId: number }
export const Stalls = defineResource<StallsRes>("Stalls");
export function installStalls(world: World, actions: StallActions, ledger = new SaleLedger()): StallsRes {
  world.register(TradeStall); world.register(OwnedBy);
  const r: StallsRes = { actions, ledger, nextStallId: 1 }; world.setResource(Stalls, r); return r;
}
/** Adds TradeStall + OwnedBy to an entity that already has a registered slot container. */
export function makeStall(world: World, e: Entity, owner: { playerId?: number; groupId?: number }, stallId?: number): number {
  const r = world.resource(Stalls); const id = stallId ?? r.nextStallId; r.nextStallId = Math.max(r.nextStallId, id + 1);
  world.add(e, TradeStall, { stallId: id }); world.add(e, OwnedBy, { playerId: owner.playerId ?? 0, groupId: owner.groupId ?? 0 });
  return id;
}
export const stallRevision = (world: World, stall: Entity): number => world.getField(stall, TradeStall, "revision") as number | undefined ?? 0;
function bump(world: World, stall: Entity): void {
  const st = world.store(TradeStall); const i = entityIndex(stall); const s = st.slot(i);
  st.data.revision[s] = (st.data.revision[s]! + 1) >>> 0; st.markChanged(i); syncStallDisplay(world, stall);
}
export function getStallListing(world: World, stall: Entity, idx: number): StallListing | undefined {
  if (!world.has(stall, TradeStall) || idx < 0 || idx >= STALL_LISTINGS) return undefined;
  const item = world.getArray(stall, TradeStall, "listItem")![idx]!; if (!item) return undefined;
  return { item, qty: world.getArray(stall, TradeStall, "listQty")![idx]!, price: world.getArray(stall, TradeStall, "listPrice")![idx]!, currency: world.getArray(stall, TradeStall, "listCurrency")![idx]! };
}
export function stallListings(world: World, stall: Entity): (StallListing | undefined)[] {
  return Array.from({ length: STALL_LISTINGS }, (_, i) => getStallListing(world, stall, i));
}
const fail = (reason: string): TxResult => ({ ok: false, reason });
const isStall = (world: World, e: Entity): boolean => world.has(e, TradeStall);

/** Set (or clear with null) listing row idx. Requires actions.manage. */
export function setStallListing(world: World, actor: Entity, stall: Entity, idx: number, l: StallListing | null): TxResult {
  if (!isStall(world, stall)) return fail("not_stall");
  if (idx < 0 || idx >= STALL_LISTINGS) return fail("bad_listing");
  if (!can(world, actor, stall, world.resource(Stalls).actions.manage)) return fail("denied");
  if (l && !(l.item > 0 && l.item <= 0xffff && l.currency > 0 && l.currency <= 0xffff && l.qty >= 1 && l.qty <= 0xffff && Number.isInteger(l.price) && l.price >= 0 && l.price <= 0xffffffff)) return fail("bad_listing");
  world.getArray(stall, TradeStall, "listItem")![idx] = l?.item ?? 0; world.getArray(stall, TradeStall, "listQty")![idx] = l?.qty ?? 0;
  world.getArray(stall, TradeStall, "listPrice")![idx] = l?.price ?? 0; world.getArray(stall, TradeStall, "listCurrency")![idx] = l?.currency ?? 0;
  bump(world, stall); return { ok: true };
}
/** Move count from (from, fromSlot) into stall slot toSlot. Requires actions.stock; container validators also run. */
export function stockStall(world: World, actor: Entity, stall: Entity, from: Entity, fromSlot: number, toSlot: number, count: number): TxResult {
  if (!isStall(world, stall)) return fail("not_stall");
  if (!can(world, actor, stall, world.resource(Stalls).actions.stock)) return fail("denied");
  const r = transaction(world, (tx) => tx.transfer(from, fromSlot, stall, toSlot, count), actor); if (r.ok) bump(world, stall); return r;
}
/** Move count from stall slot fromSlot into (to, toSlot). Requires actions.withdraw (e.g. officer+ via policy.minRole). */
export function withdrawStall(world: World, actor: Entity, stall: Entity, fromSlot: number, to: Entity, toSlot: number, count: number): TxResult {
  if (!isStall(world, stall)) return fail("not_stall");
  if (!can(world, actor, stall, world.resource(Stalls).actions.withdraw)) return fail("denied");
  const r = transaction(world, (tx) => tx.transfer(stall, fromSlot, to, toSlot, count), actor); if (r.ok) bump(world, stall); return r;
}
export type BuyResult = { ok: true; sale: SaleEntry } | { ok: false; reason: string };
export interface PurchaseSpec { buyer: Entity; stock: Entity; item: number; qty: number; currency: number; price: number; payFrom?: Entity; receiveTo?: Entity }
export type PurchaseResult = { ok: true; crafterIds: number[] } | { ok: false; reason: string };
/**
 * Generic atomic purchase over any registered containers (usable with gameplay-owned listing components):
 * qty units of item leave `stock` (keeping crafterId/durability/createdTick), price units of currency go from
 * payFrom (default buyer) into `stock`. One transaction; reasons: out_of_stock, insufficient_funds, stall_full,
 * buyer_full or a container validator reason. Nothing changes on failure. No ledger, no revision bump.
 */
export function atomicPurchase(world: World, p: PurchaseSpec): PurchaseResult {
  const payFrom = p.payFrom ?? p.buyer, receiveTo = p.receiveTo ?? p.buyer; const crafterIds: number[] = [];
  if (!(p.qty > 0)) return { ok: false, reason: "bad_qty" };
  const r = transaction(world, (tx) => {
    const goods = tx.take(p.stock, p.item, p.qty); if (!goods.ok) return fail("out_of_stock");
    if (p.price > 0) {
      const pay = tx.take(payFrom, p.currency, p.price); if (!pay.ok) return fail("insufficient_funds");
      for (const x of pay.parts) if (!tx.add(p.stock, p.currency, x.count, x.extras).ok) return fail("stall_full");
    }
    for (const x of goods.parts) { crafterIds.push(x.extras.crafterId ?? 0); if (!tx.add(receiveTo, p.item, x.count, x.extras as SlotExtras).ok) return fail("buyer_full"); }
    return { ok: true };
  }, p.buyer);
  return r.ok ? { ok: true, crafterIds } : r;
}
/**
 * Atomic purchase of one listing bundle of a TradeStall. Reasons: not_stall, no_listing, stale_revision, denied, plus
 * atomicPurchase reasons. Nothing changes on failure; success bumps revision and appends to the SaleLedger.
 */
export function buyFromStall(world: World, buyer: Entity, stall: Entity, listing: number, opts: { expectRevision?: number; payFrom?: Entity; receiveTo?: Entity } = {}): BuyResult {
  if (!isStall(world, stall)) return { ok: false, reason: "not_stall" };
  const l = getStallListing(world, stall, listing); if (!l) return { ok: false, reason: "no_listing" };
  if (opts.expectRevision !== undefined && opts.expectRevision !== stallRevision(world, stall)) return { ok: false, reason: "stale_revision" };
  const res = world.resource(Stalls);
  if (res.actions.buy && !can(world, buyer, stall, res.actions.buy)) return { ok: false, reason: "denied" };
  const r = atomicPurchase(world, { buyer, stock: stall, item: l.item, qty: l.qty, currency: l.currency, price: l.price,
    ...(opts.payFrom !== undefined ? { payFrom: opts.payFrom } : {}), ...(opts.receiveTo !== undefined ? { receiveTo: opts.receiveTo } : {}) });
  if (!r.ok) return r;
  bump(world, stall);
  const own = world.get(stall, OwnedBy);
  const sale = res.ledger.append({ tick: world.tick, stallId: world.getField(stall, TradeStall, "stallId") as number, stall, listing, buyer, buyerPlayer: playerOf(world, buyer),
    ownerPlayer: own?.playerId ?? 0, ownerGroup: own?.groupId ?? 0, item: l.item, qty: l.qty, currency: l.currency, price: l.price, crafterIds: r.crafterIds });
  return { ok: true, sale };
}
