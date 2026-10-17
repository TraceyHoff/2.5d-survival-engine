import { describe, expect, it } from "vitest";
import { Owner, Transform, World, arrayFieldsContainer, defineComponent, entityIndex, installContainers, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer, TradeEnd, TradeServer, TradeStatus, coreTradeInventory, type OfferedLine, type SlotTuple, type TradeInventory } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

/** Fake inventory: 16 parallel slot tuples per entity; atomic swap on copies (stand-in for core's container transfer). */
class FakeInv implements TradeInventory {
  slots = new Map<Entity, SlotTuple[]>(); txns: number[] = [];
  set(e: Entity, slot: number, t: Partial<SlotTuple>): void { const s = this.of(e); s[slot] = { item: 0, count: 0, durability: 0, createdTick: 0, ...t }; }
  of(e: Entity): SlotTuple[] { let s = this.slots.get(e); if (!s) { s = Array.from({ length: 16 }, () => ({ item: 0, count: 0, durability: 0, createdTick: 0 })); this.slots.set(e, s); } return s; }
  readSlot(_w: World, e: Entity, slot: number): SlotTuple | undefined { return this.of(e)[slot]; }
  swap(_w: World, a: { entity: Entity; lines: readonly OfferedLine[] }, b: { entity: Entity; lines: readonly OfferedLine[] }, txn: number): boolean {
    const A = this.of(a.entity).map((x) => ({ ...x })), B = this.of(b.entity).map((x) => ({ ...x }));
    const move = (from: SlotTuple[], to: SlotTuple[], lines: readonly OfferedLine[]): boolean => {
      for (const l of lines) {
        const src = from[l.slot]!; if (src.item !== l.item || src.count < l.count) return false;
        const dst = to.findIndex((x) => x.item === 0); if (dst < 0) return false;
        to[dst] = { item: l.item, count: l.count, durability: l.durability, createdTick: l.createdTick };
        src.count -= l.count; if (src.count === 0) from[l.slot] = { item: 0, count: 0, durability: 0, createdTick: 0 };
      }
      return true;
    };
    if (!move(A, B, a.lines) || !move(B, A, b.lines)) return false;
    this.slots.set(a.entity, A); this.slots.set(b.entity, B); this.txns.push(txn); return true;
  }
}

async function setup(n = 3) {
  const net = new LoopbackNetwork(9); const sw = makeWorld(); const inv = new FakeInv(); const ents = new Map<number, Entity>();
  const server = new NetServer({ world: sw, transport: net.createServer(), interest: false,
    onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: s.clientId * 2, y: 0 }).add(e, Owner, { clientId: s.clientId }); ents.set(s.clientId, e); } });
  let hookCode: number | undefined;
  const trade = new TradeServer(server, { inventory: inv, maxDistance: 6, idleTimeoutTicks: 100, validate: (_w, _a, _b, phase) => (phase === "tick" ? hookCode : undefined) });
  const cs: NetClient[] = [];
  for (let i = 0; i < n; i++) { const c = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 20, loss: 0.1 }) }); await join(net, c); cs.push(c); }
  const step = (k = 1) => frames(net, [sw, ...cs.map((c) => c.world)], k);
  step(2);
  for (const [cid, e] of ents) { inv.set(e, 0, { item: 100 + cid, count: 10, durability: 50, createdTick: cid }); inv.set(e, 1, { item: 200 + cid, count: 1, durability: 7, createdTick: 9 }); }
  return { net, sw, server, trade, inv, ents, cs, step, setHook: (c: number | undefined) => { hookCode = c; } };
}
async function openTrade(x: Awaited<ReturnType<typeof setup>>, a = 0, b = 1) {
  const A = x.cs[a]!, B = x.cs[b]!;
  A.trade.request(b + 1); x.step(2);
  const id = B.trade.current!.id; expect(B.trade.current!.status).toBe(TradeStatus.Requested); expect(B.trade.current!.iRequested).toBe(false);
  B.trade.accept(id); x.step(2); expect(A.trade.current!.status).toBe(TradeStatus.Open);
  return id;
}

describe("trade sessions", () => {
  it("request/accept/offer/lock/confirm commits one atomic swap of whole slot tuples", async () => {
    const x = await setup(); const [A, B] = x.cs as [NetClient, NetClient];
    const id = await openTrade(x);
    A.trade.offer(id, [{ slot: 0, count: 4 }]); B.trade.offer(id, [{ slot: 1, count: 1 }]); x.step(2);
    expect([A.trade.current!.myOfferRevision, A.trade.current!.theirOfferRevision]).toEqual([1, 1]);
    A.trade.offer(id, [{ slot: 0, count: 4 }]); x.step(2);
    expect([A.trade.current!.myOfferRevision, B.trade.current!.theirOfferRevision, B.trade.current!.myOfferRevision]).toEqual([2, 2, 1]);
    expect(A.trade.current!.theirOffer).toEqual([{ slot: 1, item: 202, count: 1, durability: 7, createdTick: 9 }]); // partner sees item details
    A.trade.lock(id); B.trade.lock(id); x.step(2);
    const v = A.trade.current!.version; A.trade.confirm(id, v); B.trade.confirm(id, v); x.step(2);
    expect(A.trade.current!.status).toBe(TradeStatus.Done); expect(B.trade.current!.status).toBe(TradeStatus.Done);
    const ia = x.inv.of(x.ents.get(1)!), ib = x.inv.of(x.ents.get(2)!);
    expect(ia[0]!.count).toBe(6); expect(ia.find((s) => s.item === 202)).toEqual({ item: 202, count: 1, durability: 7, createdTick: 9 });
    expect(ib.find((s) => s.item === 101)).toEqual({ item: 101, count: 4, durability: 50, createdTick: 1 });
    expect(x.inv.txns.length).toBe(1);
  });

  it("an offer change after lock unlocks both sides; confirms against the old version are ignored", async () => {
    const x = await setup(); const [A, B] = x.cs as [NetClient, NetClient];
    const id = await openTrade(x);
    A.trade.offer(id, [{ slot: 0, count: 10 }]); B.trade.offer(id, [{ slot: 1, count: 1 }]); x.step(2);
    A.trade.lock(id); B.trade.lock(id); x.step(2);
    const v1 = A.trade.current!.version;
    A.trade.confirm(id, v1);
    A.trade.offer(id, [{ slot: 0, count: 1 }]); // A swaps the offer right after confirming (bait)
    B.trade.confirm(id, v1); // B confirms what it saw: stale now
    x.step(3);
    const s = B.trade.current!;
    expect(s.status).toBe(TradeStatus.Open); expect(s.version).toBe(v1 + 1);
    expect([s.myLock, s.theirLock, s.myConfirm, s.theirConfirm]).toEqual([false, false, false, false]);
    expect(s.theirOffer[0]!.count).toBe(1);
    expect(x.inv.txns.length).toBe(0);
  });

  it("disconnect mid-trade cancels, nothing moves, partner is told", async () => {
    const x = await setup(); const [A, B] = x.cs as [NetClient, NetClient];
    const id = await openTrade(x);
    A.trade.offer(id, [{ slot: 0, count: 10 }]); A.trade.lock(id); B.trade.lock(id); x.step(2);
    A.close(); x.step(3);
    expect(B.trade.current!.status).toBe(TradeStatus.Cancelled); expect(B.trade.current!.reason).toBe(TradeEnd.Disconnect);
    expect(x.inv.of(x.ents.get(1)!)[0]!.count).toBe(10); expect(x.trade.activeTradeOf(2)).toBeUndefined();
  });

  it("double spend: one active trade per player, and commit re-validates the offered slots", async () => {
    const x = await setup(); const [A, B, C] = x.cs as [NetClient, NetClient, NetClient];
    // B and C request A in the same tick: only the first opens
    B.trade.request(1); C.trade.request(1); x.step(2);
    expect(C.trade.current!.status).toBe(TradeStatus.Cancelled); expect(C.trade.current!.reason).toBe(TradeEnd.Busy);
    const id = A.trade.current!.id; A.trade.accept(id); x.step(2);
    // C tries again while A-B is open: still busy
    C.trade.request(1); x.step(2); expect(C.trade.current!.reason).toBe(TradeEnd.Busy);
    // A offers its slot 0 stack, then (gameplay) moves/consumes it before commit
    A.trade.offer(id, [{ slot: 0, count: 10 }]); x.step(2); A.trade.lock(id); B.trade.lock(id); x.step(2);
    x.inv.set(x.ents.get(1)!, 0, { item: 101, count: 3, durability: 50, createdTick: 1 });
    const v = A.trade.current!.version; A.trade.confirm(id, v); B.trade.confirm(id, v); x.step(2);
    expect(B.trade.current!.status).toBe(TradeStatus.Cancelled); expect(B.trade.current!.reason).toBe(TradeEnd.Validation);
    expect(x.inv.txns.length).toBe(0);
    // a tuple that only *looks* the same (different createdTick, i.e. a different item instance) also fails
    const id2 = await openTrade(x, 0, 1);
    A.trade.offer(id2, [{ slot: 1, count: 1 }]); x.step(2); A.trade.lock(id2); B.trade.lock(id2); x.step(2);
    x.inv.set(x.ents.get(1)!, 1, { item: 201, count: 1, durability: 7, createdTick: 999 });
    const v2 = A.trade.current!.version; A.trade.confirm(id2, v2); B.trade.confirm(id2, v2); x.step(2);
    expect(B.trade.current!.reason).toBe(TradeEnd.Validation);
  });

  it("cancels on distance, death, timeout and gameplay hook", async () => {
    const x = await setup();
    let id = await openTrade(x); x.sw.setField(x.ents.get(2)!, Transform, "x", 100); x.step(2);
    expect(x.cs[0]!.trade.current!.reason).toBe(TradeEnd.Distance); void id;
    x.sw.setField(x.ents.get(2)!, Transform, "x", 4);
    id = await openTrade(x); x.sw.destroy(x.ents.get(2)!); x.step(2);
    expect(x.cs[0]!.trade.current!.reason).toBe(TradeEnd.Dead);
    id = await openTrade(x, 0, 2); x.step(110);
    expect(x.cs[0]!.trade.current!.reason).toBe(TradeEnd.Timeout);
    id = await openTrade(x, 0, 2); x.setHook(3); x.step(2);
    expect(x.cs[2]!.trade.current!.reason).toBe(TradeEnd.Hook + 3);
  });
});

describe("coreTradeInventory (core Containers + transaction)", () => {
  const Bag = defineComponent("TradeBag", { item: { type: "u16", length: 4 }, count: { type: "u16", length: 4 }, dur: { type: "u16", length: 4 }, born: { type: "u32", length: 4 } });
  it("reads core slot tuples; durability + createdTick survive the trade swap and swaps atomically; full target rolls back both sides", () => {
    const w = new World(); w.register(Bag); const C = installContainers(w);
    C.register(Bag, arrayFieldsContainer(Bag, { item: "item", count: "count", durability: "dur", createdTick: "born" }));
    const a = w.create(); w.add(a, Bag); const b = w.create(); w.add(b, Bag);
    const st = w.store(Bag); const put = (e: Entity, i: number, item: number, count: number, meta: number) => { st.writeElement(entityIndex(e), "item", i, item); st.writeElement(entityIndex(e), "count", i, count); st.writeElement(entityIndex(e), "dur", i, meta); st.writeElement(entityIndex(e), "born", i, 1000 + item); };
    put(a, 0, 5, 10, 0); put(b, 0, 7, 1, 90);
    const inv = coreTradeInventory();
    const ta = inv.readSlot(w, a, 0)!; expect(ta).toEqual({ item: 5, count: 10, durability: 0, createdTick: 1005 });
    expect(inv.readSlot(w, a, 3)).toBeUndefined();
    const tb = inv.readSlot(w, b, 0)!;
    expect(inv.swap(w, { entity: a, lines: [{ ...ta, slot: 0, count: 4 }] }, { entity: b, lines: [{ ...tb, slot: 0 }] }, 1)).toBe(true);
    expect(inv.readSlot(w, a, 0)!.count).toBe(6); expect(inv.readSlot(w, a, 1)).toEqual({ item: 7, count: 1, durability: 90, createdTick: 1007 });
    expect(inv.readSlot(w, b, 1)).toEqual({ item: 5, count: 4, durability: 0, createdTick: 1005 }); expect(inv.readSlot(w, b, 0)).toBeUndefined();
    // fill b completely -> a's line has nowhere to go; b's outgoing line must not have moved either
    put(b, 0, 8, 1, 0); put(b, 2, 8, 1, 0); put(b, 3, 8, 1, 0);
    const before = [0, 1, 2, 3].map((i) => [inv.readSlot(w, a, i), inv.readSlot(w, b, i)]);
    expect(inv.swap(w, { entity: a, lines: [{ ...inv.readSlot(w, a, 0)!, slot: 0, count: 1 }] }, { entity: b, lines: [{ ...inv.readSlot(w, b, 1)!, slot: 1 }] }, 2)).toBe(false);
    expect([0, 1, 2, 3].map((i) => [inv.readSlot(w, a, i), inv.readSlot(w, b, i)])).toEqual(before);
  });
});
