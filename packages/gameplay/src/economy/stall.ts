/**
 * Player-driven trade stalls. No NPC vendors: stock comes from players, prices are {item,count} (coin is the
 * conventional currency, crafted at the anvil), proceeds land in a separate till (offline sales allowed).
 *
 * Entities: the stall piece (BuildPiece, static) + attachments: the STOCK attachment (Container slot i = listing i,
 * StallHeader [all], Listings + StallLedger [viewers], OwnedBy) and the TILL attachment (Container, OwnedBy).
 * Permissions: core can() with gameplay StallActs bits; a permission rule maps ownership + data rank policies.
 * Every stock/payment move runs in ONE core transaction() with provenance (crafterId) carried in Slot meta.
 * validateStallPurchase / executeStallPurchase are pure helpers (no events) that the command and net can reuse.
 */
import {
  addPermissionRule, can, canAt, defineCommand, definePermissionActions, entityIndex, Membership, OwnedBy, Owner, Permissions, PlayerId,
  playerOf, Transform, transaction, type CommandDef, type Slot, type SlotExtras, type CommandHandlers, type Entity, type Transaction, type TxResult, type World,
} from "@engine/core";
import { clanPermBit, rankMask } from "../clan_state.js";
import { noteClanContribution } from "../clan.js";
import { AttachKind, BuildPiece, Container, ContainerViewers, LEDGER_SIZE, Listings, LootBag, PieceLink, STALL_NAME_MAX, StallHeader, StallLedger, StallSign, StallOwnerKind, Viewing } from "../components.js";
import { gameplayDefs, isAuthority, rangeSlack } from "../config.js";
import { emit, type GEvent } from "../events.js";
import { defineEvent } from "@engine/core";
import { attachmentsOf, pieceOf } from "../building/links.js";
import { addViewer, closeContainer, removeViewer } from "../building/actions.js";
import { distance } from "../systems/fuel.js";
import { countItem, moveSlotTuples } from "../inventory.js";
import { indexEntity } from "../spawn.js";
import { ECONOMY, type StallAction } from "./config.js";

type Part = { count: number; extras: SlotExtras };
const extrasOf = (s: Slot): SlotExtras => ({ crafterId: s.crafterId ?? 0, durability: s.durability ?? 0, createdTick: s.createdTick ?? 0 });
/** Takes `count` from one slot (listing stock) keeping provenance. */
function takeSlot(tx: Transaction, e: Entity, slot: number, count: number): Part[] | undefined {
  const s = tx.get(e, slot); if (!s.item || s.count < count || count <= 0) return undefined;
  tx.set(e, slot, { ...s, count: s.count - count }); return [{ count, extras: extrasOf(s) }];
}
function give(tx: Transaction, to: Entity, item: number, parts: readonly Part[]): TxResult {
  for (const p of parts) { const r = tx.add(to, item, p.count, p.extras); if (!r.ok) return r; } return { ok: true };
}

/** Gameplay permission bits for stalls (core can()). */
export const StallActs = definePermissionActions(["list", "price", "collect", "stock", "remove", "buy", "place"] as const);
const ACT_OF: Record<StallAction, number> = { list: StallActs.list, price: StallActs.price, collect: StallActs.collect, stock: StallActs.stock, remove: StallActs.remove };
const ALL_STALL = StallActs.list | StallActs.price | StallActs.collect | StallActs.stock | StallActs.remove | StallActs.buy;

// ---- events (reliable) ---------------------------------------------------------------------------
const ev = <T>(name: string): GEvent<T> => defineEvent<T & { tick: number }>(name) as GEvent<T>;
/** To the owner (player or clan) and the buyer. price = total paid {priceItem, priceCount}. */
export const StallSale = ev<{ stall: Entity; listingSlot: number; item: number; count: number; priceItem: number; priceCount: number; buyerId: number; crafterId: number; ownerKind: number; ownerId: number }>("gameplay.stall_sale");
export const TillCollected = ev<{ stall: Entity; collectorId: number; items: number; ownerKind: number; ownerId: number }>("gameplay.till_collected");
export const ECONOMY_EVENT_RELIABILITY = { "gameplay.stall_sale": "reliable", "gameplay.till_collected": "reliable" } as const;

// ---- resolution ----------------------------------------------------------------------------------
/** Resolves a command target (stall piece, stock or till attachment) to the stock entity (has StallHeader). */
export function stallOf(world: World, target: Entity): Entity | undefined {
  if (!world.isAlive(target)) return undefined;
  if (world.has(target, StallHeader)) return target;
  const piece = world.has(target, PieceLink) ? pieceOf(world, target) ?? target : target;
  return attachmentsOf(world, piece).find((a) => world.isAlive(a) && world.has(a, StallHeader));
}
export function tillOf(world: World, stall: Entity): Entity | undefined {
  const p = pieceOf(world, stall); if (p === undefined) return undefined;
  return attachmentsOf(world, p).find((a) => world.isAlive(a) && world.getField(a, PieceLink, "kind") === AttachKind.Till);
}
const isTill = (world: World, e: Entity): boolean => world.getField(e, PieceLink, "kind") === AttachKind.Till;

/** Sets the owner on header + OwnedBy of stock and till. */
export function setStallOwnership(world: World, stall: Entity, till: Entity | undefined, kind: number, id: number): void {
  world.set(stall, StallHeader, { ownerKind: kind, ownerId: id });
  const own = { playerId: kind === StallOwnerKind.Player ? id : 0, groupId: kind === StallOwnerKind.Clan ? id : 0 };
  if (world.isRegistered(OwnedBy)) for (const e of [stall, till]) if (e !== undefined) world.add(e, OwnedBy, own);
}
/** On placement: clan-only stalls (clan_pavilion) belong to the builder's clan; others to the builder's PlayerId. */
export function assignStallOwner(world: World, piece: Entity, builder: Entity): void {
  const stall = attachmentsOf(world, piece).find((a) => world.has(a, StallHeader)); if (stall === undefined) return;
  const def = gameplayDefs(world).pieces.get(world.getField(piece, BuildPiece, "type") ?? 0);
  const clan = world.isRegistered(Membership) ? world.getField(builder, Membership, "clanId") ?? 0 : 0;
  const player = world.isRegistered(PlayerId) ? world.getField(builder, PlayerId, "id") ?? 0 : 0;
  if (def?.stall?.clanOnly) setStallOwnership(world, stall, tillOf(world, stall), clan ? StallOwnerKind.Clan : 0, clan);
  else setStallOwnership(world, stall, tillOf(world, stall), player ? StallOwnerKind.Player : 0, player);
}

// ---- permissions ---------------------------------------------------------------------------------
/** Actions a player may take on a stall (owner = all; clan members by data rank policy; anyone may buy when open). */
export function stallRule(world: World, actor: Entity, target: Entity, action: number): "allow" | "deny" | undefined {
  if (!(action & ALL_STALL)) return undefined;
  const stall = world.has(target, StallHeader) ? target : isTill(world, target) ? stallOf(world, pieceOf(world, target) ?? target) : undefined;
  if (stall === undefined) return undefined;
  const h = world.get(stall, StallHeader)!; const player = playerOf(world, actor);
  if (action === StallActs.buy) return h.open && claimAllowsTrade(world, stall, h.ownerKind, h.ownerId) ? "allow" : "deny";
  if (!player) return "deny";
  if (h.ownerKind === StallOwnerKind.Player) return h.ownerId === player ? "allow" : "deny";
  if (h.ownerKind === StallOwnerKind.Clan) {
    const role = world.resource(Permissions).groups.role(h.ownerId, player);
    const mask = rankMask(world, h.ownerId, role); // per-clan rank masks (clan_state.ts; defaults = economy.json rankPolicy)
    return (Object.keys(ACT_OF) as StallAction[]).some((a) => ACT_OF[a] === action && (mask & clanPermBit(a)) !== 0) ? "allow" : "deny";
  }
  return "deny";
}

// ---- land claims (core ClaimRegistry) ---------------------------------------------------------------
const claimAtEntity = (world: World, e: Entity) => {
  const P = world.getResource(Permissions); const t = world.get(e, Transform); return P && t ? P.claims.claimAt(t.x, t.y) : undefined;
};
/** Whether stall owner (player or clan) belongs to the claim's owner group. */
function ownerInClaim(world: World, ownerGroup: number, kind: number, id: number): boolean {
  if (kind === StallOwnerKind.Clan) return id === ownerGroup;
  return kind === StallOwnerKind.Player && world.resource(Permissions).groups.role(ownerGroup, id) > 0;
}
/** A stall standing in a foreign claim (not its owner's) cannot sell unless data claims.tradeInForeignClaim. */
export function claimAllowsTrade(world: World, stall: Entity, kind: number, id: number): boolean {
  if (ECONOMY.claims.tradeInForeignClaim) return true;
  const c = claimAtEntity(world, stall); return !c || !c.ownerGroup || ownerInClaim(world, c.ownerGroup, kind, id);
}
/** Placement rule (canAt, target 0): NoBuild zones refuse stalls; foreign claims refuse them unless data allows. */
export function stallPlaceRule(world: World, actor: Entity, claim: { ownerGroup: number; flags: number } | undefined): "allow" | "deny" | undefined {
  if (!claim) return undefined;
  if (claim.flags & 8 /* ZoneFlag.NoBuild */) return "deny";
  if (claim.ownerGroup && !ECONOMY.claims.placeInForeignClaim && world.resource(Permissions).groups.role(claim.ownerGroup, playerOf(world, actor)) <= 0) return "deny";
  return "allow";
}
/** Validation used by placement for stall pieces: clanOnly needs a clan; claim rules when core permissions are installed. */
export function canPlaceStall(world: World, builder: Entity, x: number, y: number, clanOnly: boolean): boolean {
  if (clanOnly && !(world.isRegistered(Membership) && (world.getField(builder, Membership, "clanId") ?? 0))) return false;
  return world.getResource(Permissions) ? canAt(world, builder, x, y, StallActs.place) : true;
}

// ---- sign + sold-out (StallSign) -----------------------------------------------------------------
/** Printable ASCII only, whitespace collapsed, trimmed, capped at data stallNameMax (<= STALL_NAME_MAX). */
export function sanitizeStallName(raw: string): string {
  const max = Math.min(ECONOMY.stallNameMax, STALL_NAME_MAX);
  return raw.replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trimEnd();
}
export function stallName(world: World, stall: Entity): string {
  const n = world.getField(stall, StallSign, "nameLen") ?? 0; const a = world.getArray(stall, StallSign, "name"); if (!a) return "";
  let out = ""; for (let i = 0; i < n; i++) out += String.fromCharCode(a[i]!); return out;
}
export function writeStallName(world: World, stall: Entity, raw: string): string {
  if (!world.has(stall, StallSign)) world.add(stall, StallSign, { soldOut: 1 });
  const name = sanitizeStallName(raw); const a = world.getArray(stall, StallSign, "name")!;
  a.fill(0); for (let i = 0; i < name.length; i++) a[i] = name.charCodeAt(i);
  world.setField(stall, StallSign, "nameLen", name.length); world.store(StallSign).markChanged(entityIndex(stall)); return name;
}
/** soldOut = no enabled listing with stock >= qty. Called after every stock/listing/sale change. */
export function refreshSoldOut(world: World, stall: Entity): void {
  if (!world.has(stall, StallSign)) world.add(stall, StallSign, { soldOut: 1 });
  const sold = stallListings(world, stall).every((l) => !l.enabled || !l.stockItem || l.stock < Math.max(1, l.qty)) ? 1 : 0;
  if (world.getField(stall, StallSign, "soldOut") !== sold) world.setField(stall, StallSign, "soldOut", sold);
}
export const stallSoldOut = (world: World, stall: Entity): boolean => world.getField(stall, StallSign, "soldOut") === 1;
/** Owner (list permission) renames the sign. */
export function setStallName(world: World, actor: Entity, target: Entity, raw: string): string | undefined {
  const m = manage(world, actor, target, StallActs.list, false); if (m.why) return m.why;
  writeStallName(world, m.stall!, raw); return undefined;
}

// ---- reads ---------------------------------------------------------------------------------------
export interface Listing { slot: number; priceItem: number; priceCount: number; qty: number; enabled: boolean; stockItem: number; stock: number }
export function stallListing(world: World, stall: Entity, slot: number): Listing | undefined {
  const n = world.getField(stall, StallHeader, "listingCount") ?? 0; if (slot < 0 || slot >= n) return undefined;
  // ADR-142: a client replica can see the header before Listings / Container arrive; no data -> no listing (was a crash opening the stall).
  const L = (f: "priceItem" | "priceCount" | "qty" | "enabled") => world.getArray(stall, Listings, f);
  const pi = L("priceItem"), pc = L("priceCount"), q = L("qty"), en = L("enabled"), items = world.getArray(stall, Container, "items"), counts = world.getArray(stall, Container, "counts");
  if (!pi || !pc || !q || !en) return undefined;
  return { slot, priceItem: pi[slot] ?? 0, priceCount: pc[slot] ?? 0, qty: q[slot] ?? 0, enabled: en[slot] === 1, stockItem: items?.[slot] ?? 0, stock: counts?.[slot] ?? 0 };
}
export function stallListings(world: World, stall: Entity): Listing[] {
  const n = world.getField(stall, StallHeader, "listingCount") ?? 0; const out: Listing[] = [];
  for (let i = 0; i < n; i++) { const l = stallListing(world, stall, i); if (l) out.push(l); } return out;
}
export const listingRevision = (world: World, stall: Entity): number => world.getField(stall, Listings, "revision") ?? 0;
/** Bumps the listing revision (clients refresh; buyers' expectedRevision goes stale). */
export function bumpStall(world: World, stall: Entity): void { bump(world, stall); }
function bump(world: World, stall: Entity): void {
  const st = world.store(Listings); const i = entityIndex(stall); const s = st.slot(i); st.data.revision[s] = (st.data.revision[s]! + 1) >>> 0; st.markChanged(i);
}
export interface LedgerEntry { tick: number; item: number; count: number; priceItem: number; priceCount: number; buyerId: number; crafterId: number }
/** Newest first. */
export function stallLedger(world: World, stall: Entity): LedgerEntry[] {
  const L = world.get(stall, StallLedger); if (!L) return [];
  const a = (f: "tick" | "item" | "count" | "priceItem" | "priceCount" | "buyerId" | "crafterId") => world.getArray(stall, StallLedger, f)!;
  const out: LedgerEntry[] = []; const n = Math.min(L.total, LEDGER_SIZE);
  for (let k = 1; k <= n; k++) { const i = (L.head - k + LEDGER_SIZE) % LEDGER_SIZE; out.push({ tick: a("tick")[i]!, item: a("item")[i]!, count: a("count")[i]!, priceItem: a("priceItem")[i]!, priceCount: a("priceCount")[i]!, buyerId: a("buyerId")[i]!, crafterId: a("crafterId")[i]! }); }
  return out;
}
function appendLedger(world: World, stall: Entity, e: Omit<LedgerEntry, "tick">): void {
  const st = world.store(StallLedger); const x = entityIndex(stall); const s = st.slot(x); const h = st.data.head[s]!;
  const a = (f: "tick" | "item" | "count" | "priceItem" | "priceCount" | "buyerId" | "crafterId") => world.getArray(stall, StallLedger, f)!;
  a("tick")[h] = world.tick; a("item")[h] = e.item; a("count")[h] = e.count; a("priceItem")[h] = e.priceItem; a("priceCount")[h] = e.priceCount; a("buyerId")[h] = e.buyerId; a("crafterId")[h] = e.crafterId;
  st.data.head[s] = (h + 1) % LEDGER_SIZE; st.data.total[s] = st.data.total[s]! + 1; st.markChanged(x);
}

// ---- purchase (pure helpers) ---------------------------------------------------------------------
export interface PurchaseRequest { listingSlot: number; qty: number; expectedRevision: number; expectedPriceItem: number; expectedPriceCount: number }
/** Reason codes (CommandRejected.reason). */
export const BUY_REASONS = ["not_stall", "stall_closed", "out_of_range", "forbidden", "bad_listing", "listing_disabled", "stale_listing", "price_changed", "sold_out", "no_funds", "no_space", "till_full", "bad_qty"] as const;
export type BuyReason = (typeof BUY_REASONS)[number];

/** Read-only checks (range, permission, listing, revision, price, stock, funds). Space is checked by execute. */
export function validateStallPurchase(world: World, buyer: Entity, stallTarget: Entity, req: PurchaseRequest): BuyReason | undefined {
  const stall = stallOf(world, stallTarget); if (stall === undefined) return "not_stall";
  if (!world.getField(stall, StallHeader, "open")) return "stall_closed";
  if (distance(world, buyer, stall) > ECONOMY.browseRange + rangeSlack(world, buyer)) return "out_of_range";
  if (!can(world, buyer, stall, StallActs.buy)) return "forbidden";
  const l = stallListing(world, stall, req.listingSlot); if (!l || !l.qty || !l.priceItem) return "bad_listing";
  if (!l.enabled) return "listing_disabled";
  if (req.expectedPriceItem !== l.priceItem || req.expectedPriceCount !== l.priceCount) return "price_changed";
  if (req.expectedRevision !== listingRevision(world, stall)) return "stale_listing";
  if (!(req.qty >= 1)) return "bad_qty";
  if (l.stock < req.qty * l.qty) return "sold_out";
  if (countItem(world, buyer, l.priceItem) < req.qty * l.priceCount) return "no_funds";
  return undefined;
}

export interface PurchaseResult { item: number; count: number; priceItem: number; priceCount: number; crafterId: number }
/**
 * Moves goods (stock slot -> buyer, provenance kept) and payment (buyer -> till) inside `tx`. Re-validates stock and
 * funds against the transaction's view, so buyers serialized in one tick each see the previous buyer's result.
 */
export function executeStallPurchase(tx: Transaction, buyer: Entity, stall: Entity, till: Entity, req: PurchaseRequest): TxResult & { result?: PurchaseResult } {
  const w = tx.world; const l = stallListing(w, stall, req.listingSlot)!;
  const units = req.qty * l.qty, pay = req.qty * l.priceCount;
  const s = tx.get(stall, req.listingSlot); if (!s.item || s.count < units) return { ok: false, reason: "sold_out" };
  const goods = takeSlot(tx, stall, req.listingSlot, units); if (!goods) return { ok: false, reason: "sold_out" };
  const money = pay > 0 ? tx.take(buyer, l.priceItem, pay) : { ok: true as const, parts: [] as Part[] };
  if (!money.ok) return { ok: false, reason: "no_funds" };
  if (!give(tx, buyer, s.item, goods).ok) return { ok: false, reason: "no_space" };
  if (!give(tx, till, l.priceItem, money.parts).ok) return { ok: false, reason: "till_full" };
  return { ok: true, result: { item: s.item, count: units, priceItem: l.priceItem, priceCount: pay, crafterId: s.crafterId ?? 0 } };
}
/** Full authoritative buy: validate, one transaction, ledger + stall_sale. Returns a reason on rejection. */
export function buyFromStall(world: World, buyer: Entity, stallTarget: Entity, req: PurchaseRequest): BuyReason | undefined {
  const r = buyFromStallResult(world, buyer, stallTarget, req); return typeof r === "string" ? r : undefined;
}
/** Same as buyFromStall; on success returns the sold stack's crafterId (net StallBuyHook shape). */
export function buyFromStallResult(world: World, buyer: Entity, stallTarget: Entity, req: PurchaseRequest): BuyReason | { crafterId: number } {
  const why = validateStallPurchase(world, buyer, stallTarget, req); if (why) return why;
  const stall = stallOf(world, stallTarget)!; const till = tillOf(world, stall); if (till === undefined) return "not_stall";
  let res: PurchaseResult | undefined;
  const r = transaction(world, (tx) => { const x = executeStallPurchase(tx, buyer, stall, till, req); res = x.result; return x; }, buyer);
  if (!r.ok) return r.reason as BuyReason;
  refreshSoldOut(world, stall); const h = world.get(stall, StallHeader)!; const buyerId = playerOf(world, buyer);
  appendLedger(world, stall, { item: res!.item, count: res!.count, priceItem: res!.priceItem, priceCount: res!.priceCount, buyerId, crafterId: res!.crafterId });
  if (!world.isReplaying) emit(world, StallSale, { stall, listingSlot: req.listingSlot, item: res!.item, count: res!.count, priceItem: res!.priceItem, priceCount: res!.priceCount, buyerId, crafterId: res!.crafterId, ownerKind: h.ownerKind, ownerId: h.ownerId });
  return { crafterId: res!.crafterId };
}

// ---- owner operations ------------------------------------------------------------------------------
type R = string | undefined;
function manage(world: World, actor: Entity, target: Entity, act: number, needRange = true): { stall: Entity; why?: undefined } | { why: string; stall?: undefined } {
  const stall = stallOf(world, target); if (stall === undefined) return { why: "not_stall" };
  if (needRange && distance(world, actor, stall) > ECONOMY.browseRange + rangeSlack(world, actor)) return { why: "out_of_range" };
  if (!can(world, actor, stall, act)) return { why: "forbidden" };
  return { stall };
}
/** Stock `count` from the actor's inventory slot into listing slot (same item + crafter only). */
export function stockStall(world: World, actor: Entity, target: Entity, listingSlot: number, invSlot: number, count: number): R {
  const m = manage(world, actor, target, StallActs.stock); if (m.why) return m.why; const stall = m.stall!;
  if (listingSlot >= (world.getField(stall, StallHeader, "listingCount") ?? 0)) return "bad_listing";
  const r = transaction(world, (tx) => tx.transfer(actor, invSlot, stall, listingSlot, count), actor);
  refreshSoldOut(world, stall);
  if (r.ok && world.getField(stall, StallHeader, "ownerKind") === StallOwnerKind.Clan) noteClanContribution(world, actor, world.getField(stall, StallHeader, "ownerId") ?? 0, count);
  return r.ok ? undefined : r.reason;
}
/** Return `count` units from a listing slot to the actor (anyone allowed to stock may unstock their stall). */
export function unstockStall(world: World, actor: Entity, target: Entity, listingSlot: number, count: number): R {
  const m = manage(world, actor, target, StallActs.list); if (m.why) return m.why; const stall = m.stall!;
  const r = transaction(world, (tx) => { const s = tx.get(stall, listingSlot); if (!s.item) return { ok: false, reason: "sold_out" };
    const t = takeSlot(tx, stall, listingSlot, Math.min(count, s.count)); return t ? give(tx, actor, s.item, t) : { ok: false, reason: "sold_out" }; }, actor);
  refreshSoldOut(world, stall); return r.ok ? undefined : r.reason;
}
export interface ListingInput { priceItem: number; priceCount: number; qty: number; enabled: number }
export function setListing(world: World, actor: Entity, target: Entity, listingSlot: number, l: ListingInput): R {
  const m = manage(world, actor, target, StallActs.price); if (m.why) return m.why; const stall = m.stall!;
  if (listingSlot >= (world.getField(stall, StallHeader, "listingCount") ?? 0)) return "bad_listing";
  if (l.enabled && (!gameplayDefs(world).items.has(l.priceItem) || l.qty < 1 || l.priceCount < 1)) return "bad_listing";
  const a = (f: "priceItem" | "priceCount" | "qty" | "enabled") => world.getArray(stall, Listings, f)!;
  a("priceItem")[listingSlot] = l.priceItem; a("priceCount")[listingSlot] = l.priceCount; a("qty")[listingSlot] = l.qty; a("enabled")[listingSlot] = l.enabled ? 1 : 0;
  bump(world, stall); refreshSoldOut(world, stall); return undefined;
}
export function setStallOpen(world: World, actor: Entity, target: Entity, open: number): R {
  const m = manage(world, actor, target, StallActs.list); if (m.why) return m.why;
  world.setField(m.stall!, StallHeader, "open", open ? 1 : 0); bump(world, m.stall!); return undefined;
}
/** Moves the whole till to the actor (all-or-nothing). */
export function collectTill(world: World, actor: Entity, target: Entity): R {
  const m = manage(world, actor, target, StallActs.collect); if (m.why) return m.why; const stall = m.stall!;
  const till = tillOf(world, stall); if (till === undefined) return "not_stall";
  let moved = 0;
  const r = transaction(world, (tx) => {
    const n = tx.reg.adapterFor(world, till)!.capacity(world, till);
    for (let i = 0; i < n; i++) { const s = tx.get(till, i); if (!s.item) continue; tx.set(till, i, { item: 0, count: 0, meta: 0 }); const g = tx.add(actor, s.item, s.count, extrasOf(s)); if (!g.ok) return g; moved += s.count; }
    return moved ? { ok: true } : { ok: false, reason: "till_empty" };
  }, actor);
  if (!r.ok) return r.reason;
  const h = world.get(stall, StallHeader)!;
  if (!world.isReplaying) emit(world, TillCollected, { stall, collectorId: playerOf(world, actor), items: moved, ownerKind: h.ownerKind, ownerId: h.ownerId });
  return undefined;
}
/** Browse: range check, then the actor's client joins the viewers scope (Listings + stock + ledger replicate to it). */
export function openStall(world: World, actor: Entity, target: Entity): R {
  const stall = stallOf(world, target); if (stall === undefined) return "not_stall";
  if (distance(world, actor, stall) > ECONOMY.browseRange + rangeSlack(world, actor)) return "out_of_range";
  const client = world.getField(actor, Owner, "clientId") ?? 0;
  if (world.getField(actor, Viewing, "container") !== stall) {
    leaveStallTill(world, actor); closeContainer(world, actor);
    if (!addViewer(world, stall, client)) return "viewers_full";
    world.add(actor, Viewing, { container: stall });
  }
  // ADR-143: the till is its own Container (viewer-scoped too); managers who may collect also view it, else the owner's
  // panel always read "Till: empty" and Collect till stayed disabled on clients.
  const till = tillOf(world, stall); if (till !== undefined && can(world, actor, stall, StallActs.collect)) { if (!world.has(till, ContainerViewers)) world.add(till, ContainerViewers); addViewer(world, till, client); }
  return undefined;
}
/** Drop the actor's client from the till of the stall it is viewing (if any). */
function leaveStallTill(world: World, actor: Entity): void {
  const cur = world.getField(actor, Viewing, "container"); if (cur === undefined || !world.isAlive(cur) || !world.has(cur, StallHeader)) return;
  const till = tillOf(world, cur); if (till !== undefined) removeViewer(world, till, world.getField(actor, Owner, "clientId") ?? 0);
}
export function closeStall(world: World, actor: Entity): R { leaveStallTill(world, actor); closeContainer(world, actor); return undefined; }

/** Destroyed stalls spill stock and till into loot bags when data stallStockLootable (default true). Server only. */
export function spillStall(world: World, att: Entity): Entity | undefined {
  if (!ECONOMY.stallStockLootable || !isAuthority(world) || world.isReplaying) return undefined;
  if (!world.has(att, StallHeader) && !isTill(world, att)) return undefined;
  const n = world.getField(att, Container, "slotCount") ?? 0; const items = world.getArray(att, Container, "items")!; const counts = world.getArray(att, Container, "counts")!;
  const moves: { slot: number; count: number }[] = []; for (let i = 0; i < n; i++) if (items[i] && counts[i]) moves.push({ slot: i, count: counts[i]! });
  if (!moves.length) return undefined;
  const t = world.get(att, Transform)!; const bag = world.create();
  world.add(bag, Transform, { x: t.x, y: t.y, z: t.z }).add(bag, Container, { slotCount: 24 }).add(bag, ContainerViewers)
    .add(bag, LootBag, { owner: 0, despawnAtTick: world.tick + 20 * 600 });
  moveSlotTuples(world, att, bag, moves); indexEntity(world, bag); if (world.has(att, StallSign)) refreshSoldOut(world, att); return bag;
}

// ---- commands (append-only ids, registered after GAMEPLAY_COMMANDS) ---------------------------------
export const OpenStallCmd = defineCommand("gameplay.openStall", { stall: "u32" });
export const CloseStallCmd = defineCommand("gameplay.closeStall", {});
export const StockStallCmd = defineCommand("gameplay.stockStall", { stall: "u32", listingSlot: "u8", invSlot: "u8", count: "u16" });
export const UnstockStallCmd = defineCommand("gameplay.unstockStall", { stall: "u32", listingSlot: "u8", count: "u16" });
export const SetListingCmd = defineCommand("gameplay.setListing", { stall: "u32", listingSlot: "u8", priceItem: "u16", priceCount: "u16", qty: "u16", enabled: "u8" });
export const BuyFromStallCmd = defineCommand("gameplay.buyFromStall", { stall: "u32", listingSlot: "u8", qty: "u16", expectedRevision: "u32", expectedPriceItem: "u16", expectedPriceCount: "u16" });
export const CollectTillCmd = defineCommand("gameplay.collectTill", { stall: "u32" });
export const SetStallOpenCmd = defineCommand("gameplay.setStallOpen", { stall: "u32", open: "u8" });
/** Sign text as bytes (len used); the server sanitizes. */
export const SetStallNameCmd = defineCommand("gameplay.setStallName", { stall: "u32", len: "u8", name: { type: "u8", length: STALL_NAME_MAX } });
export const ECONOMY_COMMANDS: readonly CommandDef[] = [OpenStallCmd, CloseStallCmd, StockStallCmd, UnstockStallCmd, SetListingCmd, BuyFromStallCmd, CollectTillCmd, SetStallOpenCmd, SetStallNameCmd];
/** NetId fields net resolves to Entities. */
export const ECONOMY_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(ECONOMY_COMMANDS.filter((d) => "stall" in d.schema).map((d) => [d.name, ["stall"]]));
export const ECONOMY_COMMAND_RATES: Readonly<Record<string, number>> = Object.fromEntries(ECONOMY_COMMANDS.map((d) => [d.name, d === BuyFromStallCmd ? ECONOMY.buyRatePerSecond : 8]));

/**
 * Server: adds the stall permission rule and (given core CommandHandlers from installCommandHandlers) the command
 * handlers. Rejections surface as core CommandRejected with the reason codes above. Call after installPermissions.
 */
export function installEconomy(world: World, handlers?: CommandHandlers): void {
  addPermissionRule(world, (ctx) => ctx.target ? stallRule(ctx.world, ctx.actor, ctx.target, ctx.action) : ctx.action === StallActs.place ? stallPlaceRule(ctx.world, ctx.actor, ctx.claim) : undefined);
  if (!handlers) return;
  // validate does the work so the reason reaches CommandRejected; handle is a no-op (the op already ran or nothing changed)
  const op = <V>(f: (v: V, actor: Entity) => R) => ({ validate: (v: V, ctx: { actor: Entity }) => f(v, ctx.actor), handle: () => {} });
  type V = Record<string, number>;
  handlers.on(OpenStallCmd, op<V>((v, a) => openStall(world, a, v.stall!)));
  handlers.on(CloseStallCmd, op<V>((_v, a) => closeStall(world, a)));
  handlers.on(StockStallCmd, op<V>((v, a) => stockStall(world, a, v.stall!, v.listingSlot!, v.invSlot!, v.count!)));
  handlers.on(UnstockStallCmd, op<V>((v, a) => unstockStall(world, a, v.stall!, v.listingSlot!, v.count!)));
  handlers.on(SetListingCmd, op<V>((v, a) => setListing(world, a, v.stall!, v.listingSlot!, { priceItem: v.priceItem!, priceCount: v.priceCount!, qty: v.qty!, enabled: v.enabled! })));
  handlers.on(BuyFromStallCmd, op<V>((v, a) => buyFromStall(world, a, v.stall!, { listingSlot: v.listingSlot!, qty: v.qty!, expectedRevision: v.expectedRevision!, expectedPriceItem: v.expectedPriceItem!, expectedPriceCount: v.expectedPriceCount! })));
  handlers.on(CollectTillCmd, op<V>((v, a) => collectTill(world, a, v.stall!)));
  handlers.on(SetStallOpenCmd, op<V>((v, a) => setStallOpen(world, a, v.stall!, v.open!)));
  handlers.on(SetStallNameCmd, op<{ stall: number; len: number; name: ArrayLike<number> }>((v, a) =>
    setStallName(world, a, v.stall, Array.from({ length: Math.min(v.len, STALL_NAME_MAX) }, (_, i) => String.fromCharCode(v.name[i] ?? 32)).join(""))));
}
