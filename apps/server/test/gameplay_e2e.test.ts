import { describe, it, expect } from "vitest";
import { PlayerId, Transform, World, type Entity, type EventType } from "@engine/core";
import {
  addItem, checkHit, countItem, defaultDefs, HitRejected, listSlots, listingRevision, placePiece, setListing, setStallOpen, snapPlacement,
  stallListing, stallOf, stockStall, tillOf, BuyFromStallCmd, RespawnCmd,
} from "@engine/gameplay";
import { LoopbackNetwork, NetClient, StallResult, type SaleMsg } from "@engine/net";
import { ClaimAccount, MemoryWorldStore, SetName, nameToWords } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, onGameplayRejected, rejectReasonCode, rejectReasonName, DEMO_COMMANDS, DEMO_EVENTS, type GameplayRejection } from "../src/main.js";

const d = defaultDefs(); const COIN = d.itemId("coin"), PLANK = d.itemId("planks");

async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5 });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (name?: string): Promise<{ c: NetClient; e: Entity; pid: number }> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); if (name) c.sendCommand(SetName, nameToWords(name)); tick(3);
    const e = gs.players.get(c.clientId!)!.entity; return { c, e, pid: gs.world.getField(e, PlayerId, "id")! };
  };
  return { gs, tick, connect };
}
const at = (w: World, e: Entity) => w.get(e, Transform)!;
function place(w: World, builder: Entity, key: string, x: number, y: number): Entity {
  const sn = snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
  return placePiece(w, builder, sn, { pay: false });
}

describe("apps/server end-to-end gameplay", () => {
  async function stocked() {
    const s = await setup(); const w = s.gs.world;
    const A = await s.connect("Ada"); const B = await s.connect("Bo");
    const p = at(w, A.e); const stall = stallOf(w, place(w, A.e, "stall_booth", Math.floor(p.x) + 1, Math.floor(p.y)))!;
    addItem(w, A.e, PLANK, 20, A.pid); // crafted by Ada
    expect(stockStall(w, A.e, stall, 0, listSlots(w, A.e).find((x) => x.item === PLANK)!.slot, 20)).toBeUndefined();
    expect(setListing(w, A.e, stall, 0, { priceItem: COIN, priceCount: 3, qty: 5, enabled: 1 })).toBeUndefined();
    expect(setStallOpen(w, A.e, stall, 1)).toBeUndefined();
    addItem(w, B.e, COIN, 10);
    const st = at(w, stall); w.set(B.e, Transform, { x: st.x + 1, y: st.y }); w.set(A.e, Transform, { x: st.x - 1, y: st.y });
    s.tick(3);
    const netId = s.gs.net.netIds.netIdOf(stall) ?? s.gs.net.netIds.assign(stall);
    const buy = (c: NetClient, price = 3, qty = 1) => c.stalls.buy(netId, 0, listingRevision(w, stall), { itemId: COIN, count: price }, qty);
    return { ...s, w, A, B, stall, netId, buy };
  }

  it("a stall purchase through the gameplay buy hook moves goods + coin, keeps the crafter, notifies owner and buyer with names", async () => {
    const { w, tick, A, B, stall, buy } = await stocked();
    const salesA: SaleMsg[] = [], salesB: SaleMsg[] = []; A.c.stalls.onSale((m) => salesA.push(m)); B.c.stalls.onSale((m) => salesB.push(m));
    const r = buy(B.c); tick(4);
    expect((await r).reason).toBe(StallResult.Ok);
    expect(countItem(w, B.e, PLANK)).toBe(5); expect(countItem(w, B.e, COIN)).toBe(7);
    expect(countItem(w, tillOf(w, stall)!, COIN)).toBe(3); expect(stallListing(w, stall, 0)!.stock).toBe(15);
    expect(listSlots(w, B.e).filter((x) => x.item === PLANK).every((x) => x.crafterId === A.pid)).toBe(true);
    for (const m of [salesA, salesB]) expect(m).toEqual([expect.objectContaining({ item: PLANK, crafterId: A.pid, buyerId: B.pid })]);
    tick(3);
    expect(B.c.names.get(A.pid)).toBe("Ada"); expect(A.c.names.get(B.pid)).toBe("Bo");
  });

  it("price_changed and sold_out races are reported with their stall result codes", async () => {
    const { w, tick, A, B, stall, buy } = await stocked();
    expect(setListing(w, A.e, stall, 0, { priceItem: COIN, priceCount: 4, qty: 5, enabled: 1 })).toBeUndefined(); // owner reprices first
    const r1 = buy(B.c, 3); tick(4); expect((await r1).reason).toBe(StallResult.PriceChanged);
    expect(countItem(w, B.e, COIN)).toBe(10);
    addItem(w, B.e, COIN, 40); const r2 = buy(B.c, 4, 5); tick(4); expect((await r2).reason).toBe(StallResult.SoldOut); // 20 stock < 5 x 5
    expect(countItem(w, B.e, PLANK)).toBe(0); expect(stallListing(w, stall, 0)!.stock).toBe(20);
  });

  it("a real watchtower raises the view bonus and the client receives the extra chunks", async () => {
    const { gs, tick, connect } = await setup(); const w = gs.world;
    const A = await connect(); tick(20);
    const id = A.c.clientId!; const before = gs.net.relevantChunks(id)!.size, fulls = A.c.tiles.stats.fulls;
    expect(gs.net.viewRadiusBonus(id)).toBe(0);
    const p = at(w, A.e); place(w, A.e, "watchtower", Math.floor(p.x), Math.floor(p.y)); w.set(A.e, Transform, { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
    tick(40);
    expect(gs.net.viewRadiusBonus(id)).toBe(1);
    expect(gs.net.relevantChunks(id)!.size).toBeGreaterThan(before);
    expect(A.c.tiles.stats.fulls).toBeGreaterThan(fulls);
  });

  it("a lag-compensated hit against where the attacker last saw the target is rejected", async () => {
    const { gs, tick, connect } = await setup(); const w = gs.world;
    const A = await connect(); const B = await connect(); tick(10);
    const a = at(w, A.e); w.set(B.e, Transform, { x: a.x + 20, y: a.y }); tick(10); // attacker has seen B far away
    const rejected: string[] = []; w.events.on(HitRejected as unknown as EventType<{ reason: string }>, (r) => { rejected.push(r.reason); });
    w.set(B.e, Transform, { x: a.x + 1, y: a.y }); gs.step(1 / 20); // B is now in reach, but A has not seen it yet
    expect(checkHit(w, A.e, B.e, 1.5)).toBe(false);
    tick(1); expect(rejected).toEqual(["reach"]);
    tick(10); expect(checkHit(w, A.e, B.e, 1.5)).toBe(true); // once seen, the same hit lands
  });

  it("forwards command rejections to the issuing client with a reason code", async () => {
    const { tick, connect } = await setup();
    const A = await connect(); const B = await connect();
    const got: GameplayRejection[] = [], other: GameplayRejection[] = [];
    onGameplayRejected(A.c, (r) => got.push(r)); onGameplayRejected(B.c, (r) => other.push(r));
    A.c.sendCommand(gameplayNet(RespawnCmd), {} as never); // alive: not_dead
    A.c.sendCommand(gameplayNet(BuyFromStallCmd), { stall: 0, listingSlot: 0, qty: 1, expectedRevision: 0, expectedPriceItem: 0, expectedPriceCount: 0 });
    tick(5);
    expect(got.map((r) => [r.command.name, r.reason])).toEqual([["gameplay.respawnPlayer", "not_dead"], ["gameplay.buyFromStall", "not_stall"]]);
    expect(got[0]!.code).toBe(rejectReasonCode("not_dead")); expect(got[0]!.raw.detail).toBe("not_dead");
    expect(other).toEqual([]);
    expect(rejectReasonCode("whatever")).toBe(0); expect(rejectReasonName(0)).toBeUndefined(); expect(rejectReasonName(rejectReasonCode("sold_out"))).toBe("sold_out");
  });
});
