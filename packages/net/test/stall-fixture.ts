/**
 * Stand-in gameplay for stall tests (the real StallHeader/Listings are gameplay's). Mirrors the locked shape:
 * StallHeader {ownerKind, ownerId, open, listingCount} scope "all"; Listings {revision + 24 parallel listing arrays}
 * scope viewers (clients with the stall open). Stock/till/player bags are core containers carrying crafterId.
 */
import { Containers, Owner, Transform, arrayFieldsContainer, defineComponent, entityIndex, installContainers, type Entity, type World } from "@engine/core";
import { LoopbackNetwork, MAX_LISTINGS, NetClient, NetServer, StallResult, StallServer, type ListingView, type StallHooks, type StallView } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const A24 = <T extends string>(type: T) => ({ type, length: MAX_LISTINGS });
export const StallHeader = defineComponent("T_StallHeader", { ownerKind: "u8", ownerId: "u32", open: "u8", listingCount: "u8" }, { networked: true });
export const Listings = defineComponent("T_Listings", {
  revision: "u32", listingId: A24("u16"), slot: A24("u8"), item: A24("u16"), count: A24("u16"), durability: A24("u16"), crafterId: A24("u32"), priceItem: A24("u16"), priceCount: A24("u16"),
}, { networked: true });
export const Bag = defineComponent("T_Bag", { item: A24("u16"), count: A24("u16"), dur: A24("u16"), crafter: A24("u32") });
export const COIN = 1;
export const mkWorld = (): World => { const w = makeWorld(); w.register(StallHeader); w.register(Listings); w.register(Bag); return w; };

export interface Rig { net: LoopbackNetwork; sw: World; server: NetServer; stalls: StallServer; cs: NetClient[]; players: Map<number, Entity>; pid: Map<number, number>;
  step(k?: number): void; viewers: Map<Entity, Set<number>>; till: Map<Entity, Entity>; ranks: Map<number, number>;
  put(e: Entity, slot: number, item: number, count: number, crafter?: number, dur?: number): void; slot(e: Entity, i: number): { item: number; count: number; crafter: number; dur: number };
  total(e: Entity, item: number): number; makeStall(x: number, y: number, ownerKind: number, ownerId: number): Entity; addClient(pid: number, x?: number, y?: number, loss?: number): Promise<NetClient>;
  listItem(stall: Entity, slot: number, price: { itemId: number; count: number }): number; canBuy: { allow: boolean } }

export async function stallRig(o: { n?: number; loss?: number; interest?: false | { radius: number } } = {}): Promise<Rig> {
  const net = new LoopbackNetwork(13); const sw = mkWorld(); installContainers(sw).register(Bag, arrayFieldsContainer(Bag, { item: "item", count: "count", durability: "dur", crafterId: "crafter" }));
  const players = new Map<number, Entity>(); const pid = new Map<number, number>(); const viewers = new Map<Entity, Set<number>>(); const till = new Map<Entity, Entity>();
  const ranks = new Map<number, number>(); // clan member playerId -> rank (1 member, 2 officer, 3 leader)
  const joinQueue: { pid: number; x: number; y: number }[] = []; const canBuy = { allow: true };
  const st = () => sw.store(Bag);
  const put = (e: Entity, i: number, item: number, count: number, crafter = 0, dur = 0) => { const x = entityIndex(e); st().writeElement(x, "item", i, item); st().writeElement(x, "count", i, count); st().writeElement(x, "crafter", i, crafter); st().writeElement(x, "dur", i, dur); };
  const slot = (e: Entity, i: number) => { const x = entityIndex(e); return { item: st().readElement(x, "item", i)!, count: st().readElement(x, "count", i)!, crafter: st().readElement(x, "crafter", i)!, dur: st().readElement(x, "dur", i)! }; };
  const total = (e: Entity, item: number) => { let n = 0; for (let i = 0; i < MAX_LISTINGS; i++) { const s = slot(e, i); if (s.item === item) n += s.count; } return n; };
  const server = new NetServer({ world: sw, transport: net.createServer(), interest: o.interest ?? false,
    onClientJoin: (s, w) => { const j = joinQueue.shift()!; const e = w.create(); w.add(e, Transform, { x: j.x, y: j.y }).add(e, Owner, { clientId: s.clientId }).add(e, Bag); players.set(s.clientId, e); pid.set(s.clientId, j.pid); },
    onClientLeave: (s, w) => { const e = players.get(s.clientId); if (e !== undefined && w.isAlive(e)) w.destroy(e); players.delete(s.clientId); for (const v of viewers.values()) v.delete(s.clientId); } });
  server.setScope(Listings, (_w, e, c) => viewers.get(e)?.has(c) ?? false);
  const lw = (e: Entity) => sw.get(e, Listings)! as unknown as Record<string, number[]> & { revision: number };
  const bump = (e: Entity) => sw.setField(e, Listings, "revision", sw.getField(e, Listings, "revision")! + 1);
  const setL = (e: Entity, i: number, f: string, v: number) => { (sw.store(Listings) as unknown as { writeElement(x: number, f: string, i: number, v: number): void }).writeElement(entityIndex(e), f, i, v); };
  const recount = (e: Entity) => { const l = lw(e); sw.setField(e, StallHeader, "listingCount", l.listingId!.filter((x) => x).length); };
  const view = (w: World, e: Entity): StallView | undefined => {
    const h = w.get(e, StallHeader); if (!h) return undefined; const l = lw(e);
    return { open: !!h.open, ownerKind: h.ownerKind, ownerId: h.ownerId, revision: l.revision, stock: e, till: till.get(e)!,
      listing: (id): ListingView | undefined => { const i = l.listingId!.indexOf(id); if (!id || i < 0) return undefined;
        return { listingId: id, slot: l.slot![i]!, item: l.item![i]!, count: l.count![i]!, durability: l.durability![i]!, crafterId: l.crafterId![i]!, price: { itemId: l.priceItem![i]!, count: l.priceCount![i]! } }; } };
  };
  let nextListing = 1;
  const listItem = (e: Entity, s: number, price: { itemId: number; count: number }): number => {
    const b = slot(e, s); const id = nextListing++;
    setL(e, s, "listingId", id); setL(e, s, "slot", s); setL(e, s, "item", b.item); setL(e, s, "count", b.count); setL(e, s, "durability", b.dur); setL(e, s, "crafterId", b.crafter);
    setL(e, s, "priceItem", price.itemId); setL(e, s, "priceCount", price.count); bump(e); recount(e); sw.setField(e, Listings, "revision", lw(e).revision); return id;
  };
  const playerOfClient = (s: { clientId: number }) => pid.get(s.clientId) ?? 0;
  const hooks: StallHooks = {
    view,
    canBuy: () => canBuy.allow,
    canManage: (w, _a, e, op, s) => { const h = w.get(e, StallHeader)!; const p = playerOfClient(s);
      if (h.ownerKind === 0) return h.ownerId === p;
      const r = ranks.get(p) ?? 0; return op === 4 /* collect */ ? r >= 3 : r >= 2; },
    owner: (w, c) => {
      const l = lw(c.stall);
      if (c.op === 1) return { reason: 0, detail: listItem(c.stall, c.slot!, c.price!) };
      const i = l.listingId!.indexOf(c.listingId ?? 0);
      if (c.op === 2) { if (i < 0) return StallResult.SoldOut; setL(c.stall, i, "priceItem", c.price!.itemId); setL(c.stall, i, "priceCount", c.price!.count); bump(c.stall); return 0; }
      if (c.op === 3) { // delist: stock back to the owner (withdraw)
        if (i < 0) return StallResult.SoldOut; const s = l.slot![i]!; const b = slot(c.stall, s);
        put(c.actor, 20, b.item, b.count, b.crafter, b.dur); put(c.stall, s, 0, 0); setL(c.stall, i, "listingId", 0); setL(c.stall, i, "count", 0); bump(c.stall); recount(c.stall); return 0;
      }
      const t = till.get(c.stall)!; const n = total(t, COIN); for (let k = 0; k < MAX_LISTINGS; k++) put(t, k, 0, 0);
      const rr = w.resource(Containers); void rr; put(c.actor, 21, COIN, n + total(c.actor, COIN) - (slot(c.actor, 21).item === COIN ? slot(c.actor, 21).count : 0)); return { reason: 0, detail: n };
    },
    sold: (_w, e, sale) => { const l = lw(e); const i = l.listingId!.indexOf(sale.listingId); const left = l.count![i]! - sale.qty; setL(e, i, "count", left); if (!left) setL(e, i, "listingId", 0); bump(e); recount(e); },
    saleRecipients: (_w, _e, v) => (v.ownerKind === 0 ? [v.ownerId] : [...ranks].filter(([, r]) => r >= 2).map(([p]) => p)),
  };
  const stalls = new StallServer(server, { hooks, playerIdOf: playerOfClient });
  const cs: NetClient[] = [];
  const addClient = async (p: number, x = 10, y = 10, loss = o.loss ?? 0) => { joinQueue.push({ pid: p, x, y }); const c = new NetClient({ world: mkWorld(), transport: net.createClient({ latencyMs: 30, jitterMs: 5, loss }) }); await join(net, c); cs.push(c); return c; };
  for (let i = 0; i < (o.n ?? 0); i++) await addClient(i + 1);
  const step = (k = 1) => frames(net, [sw, ...cs.map((c) => c.world)], k);
  const makeStall = (x: number, y: number, ownerKind: number, ownerId: number): Entity => {
    const e = sw.create(); sw.add(e, Transform, { x, y }).add(e, StallHeader, { ownerKind, ownerId, open: 1, listingCount: 0 }).add(e, Listings).add(e, Bag);
    const t = sw.create(); sw.add(t, Bag); till.set(e, t); viewers.set(e, new Set()); server.netIds.assign(e); return e;
  };
  return { net, sw, server, stalls, cs, players, pid, step, viewers, till, ranks, put, slot, total, makeStall, addClient, listItem, canBuy };
}
