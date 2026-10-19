/** Stall buys over core's TradeStall/buyFromStall (ADR-075) through net's stall transport (coreStallView / coreStallBuy). */
import { describe, expect, it } from "vitest";
import { Owner, PlayerId, Transform, arrayFieldsContainer, defineComponent, definePermissionActions, installContainers, installPermissions, installStalls, makeStall, setStallListing, stallRevision, transaction, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer, StallResult, StallServer, coreStallBuy, coreStallView, mapCoreBuyReason, type StallResultMsg } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const N = 8;
const Inv = defineComponent("NetInvEco", { items: { type: "u16", length: N }, counts: { type: "u16", length: N }, durability: { type: "u16", length: N }, crafterId: { type: "u32", length: N } });
const A = definePermissionActions(["NStock", "NWithdraw", "NManage"]);
const COIN = 9, AXE = 7;

const mk = () => { const w = makeWorld(); w.register(Inv); w.register(PlayerId);
  installContainers(w).register(Inv, arrayFieldsContainer(Inv, { item: "items", count: "counts", durability: "durability", crafterId: "crafterId" }));
  installPermissions(w); installStalls(w, { stock: A.NStock, withdraw: A.NWithdraw, manage: A.NManage }); return w; };
async function setup() {
  const net = new LoopbackNetwork(8); const sw = mk();
  const players = new Map<number, Entity>();
  const server = new NetServer({ world: sw, transport: net.createServer(), interest: false,
    onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 10 + s.clientId, y: 10 }).add(e, Owner, { clientId: s.clientId }).add(e, Inv).add(e, PlayerId, { id: 100 + s.clientId }); players.set(s.clientId, e); } });
  const stalls = new StallServer(server, { playerIdOf: (s) => 100 + s.clientId, hooks: {
    view: (w, e) => coreStallView(w, e), buy: coreStallBuy, canManage: () => true, owner: () => 0, sold: () => {}, saleRecipients: (_w, _e, v) => [v.ownerId] } });
  const cs: NetClient[] = [];
  for (let i = 0; i < 3; i++) { const c = new NetClient({ world: mk(), transport: net.createClient({ latencyMs: 30, loss: 0.1 }) }); await join(net, c); cs.push(c); }
  const step = (k = 1) => frames(net, [sw, ...cs.map((c) => c.world)], k); step(3);
  const owner = players.get(1)!;
  const stall = sw.create(); sw.add(stall, Transform, { x: 12, y: 11 }).add(stall, Inv); makeStall(sw, stall, { playerId: 101 }); server.netIds.assign(stall);
  transaction(sw, (tx) => tx.add(stall, AXE, 1, { crafterId: 555, durability: 80 }));
  expect(setStallListing(sw, owner, stall, 0, { item: AXE, qty: 1, price: 20, currency: COIN }).ok).toBe(true);
  for (const c of [2, 3]) transaction(sw, (tx) => tx.add(players.get(c)!, COIN, 50));
  step(3);
  const nid = server.netIds.netIdOf(stall)!;
  const res = async (p: Promise<StallResultMsg>) => { let o: StallResultMsg | undefined; void p.then((r) => (o = r)); for (let i = 0; i < 60 && !o; i++) { step(1); await Promise.resolve(); } return o!; };
  const coins = (e: Entity) => { const v = sw.get(e, Inv)! as unknown as { items: number[]; counts: number[] }; return v.items.reduce((n, it, i) => n + (it === COIN ? v.counts[i]! : 0), 0); };
  return { sw, server, stalls, cs, players, owner, stall, nid, step, res, coins };
}

describe("stall buys via core buyFromStall", () => {
  it("same-tick race on the last unit: one Ok, one SoldOut (stale_revision mapped); crafterId reaches buyer + sale", async () => {
    const x = await setup(); const rev = stallRevision(x.sw, x.stall);
    const sales: unknown[] = []; x.cs[0]!.stalls.onSale((s) => sales.push(s));
    const pa = x.cs[1]!.stalls.buy(x.nid, 1, rev, { itemId: COIN, count: 20 }); const pb = x.cs[2]!.stalls.buy(x.nid, 1, rev, { itemId: COIN, count: 20 });
    const r = [(await x.res(pa)).reason, (await x.res(pb)).reason].sort(); expect(r).toEqual([StallResult.Ok, StallResult.SoldOut]);
    expect(x.coins(x.players.get(2)!) + x.coins(x.players.get(3)!)).toBe(80); expect(x.coins(x.stall)).toBe(20);
    const winner = [2, 3].map((c) => x.players.get(c)!).find((e) => (x.sw.get(e, Inv)! as unknown as { items: number[] }).items.includes(AXE))!;
    const inv = x.sw.get(winner, Inv)! as unknown as { items: number[]; crafterId: number[]; durability: number[] }; const i = inv.items.indexOf(AXE);
    expect([inv.crafterId[i], inv.durability[i]]).toEqual([555, 80]);
    x.step(6); expect(sales).toEqual([expect.objectContaining({ item: AXE, crafterId: 555, price: { itemId: COIN, count: 20 } })]);
  });

  it("stale price -> PriceChanged (old price, or right price with an old revision); revision-only change keeps SoldOut/PriceChanged semantics", async () => {
    const x = await setup(); const rev0 = stallRevision(x.sw, x.stall);
    transaction(x.sw, (tx) => tx.add(x.stall, AXE, 2, { crafterId: 556, durability: 80 }));
    expect(setStallListing(x.sw, x.owner, x.stall, 0, { item: AXE, qty: 1, price: 25, currency: COIN }).ok).toBe(true); x.step(2);
    expect((await x.res(x.cs[1]!.stalls.buy(x.nid, 1, rev0, { itemId: COIN, count: 20 }))).reason).toBe(StallResult.PriceChanged);
    expect((await x.res(x.cs[1]!.stalls.buy(x.nid, 1, rev0, { itemId: COIN, count: 25 }))).reason).toBe(StallResult.PriceChanged); // stale_revision, still in stock
    expect(x.coins(x.players.get(2)!)).toBe(50);
    expect((await x.res(x.cs[1]!.stalls.buy(x.nid, 1, stallRevision(x.sw, x.stall), { itemId: COIN, count: 25 }))).reason).toBe(StallResult.Ok);
    expect(mapCoreBuyReason(x.sw, x.stall, 5, "stale_revision")).toBe(StallResult.SoldOut); // no such listing
    expect(mapCoreBuyReason(x.sw, x.stall, 1, "insufficient_funds")).toBe(StallResult.NoFunds);
    expect((await x.res(x.cs[1]!.stalls.buy(x.nid, 1, stallRevision(x.sw, x.stall), { itemId: COIN, count: 25 }, 2))).reason).toBe(StallResult.BadRequest); // one bundle per request
  });
});
