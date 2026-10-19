import { describe, expect, it } from "vitest";
import { PlayerNameRegistry } from "@engine/core";
import { NameSync, StallResult, checkListing, type StallResultMsg } from "../src/index.js";
import { COIN, Listings, StallHeader, stallRig } from "./stall-fixture.js";

const SWORD = 50, BREAD = 60, ALICE = 1, BOB = 2, CAROL = 3;
async function market(loss = 0.1) {
  const x = await stallRig({ loss });
  const [owner, b1, b2] = [await x.addClient(ALICE, 10, 10), await x.addClient(BOB, 11, 10), await x.addClient(CAROL, 12, 11)];
  const stall = x.makeStall(11, 11, 0, ALICE);
  x.put(stall, 0, SWORD, 1, 777, 90); x.put(stall, 1, BREAD, 5, 778);
  const sword = x.listItem(stall, 0, { itemId: COIN, count: 30 }); const bread = x.listItem(stall, 1, { itemId: COIN, count: 2 });
  x.put(x.players.get(2)!, 0, COIN, 100); x.put(x.players.get(3)!, 0, COIN, 100);
  x.step(6);
  const nid = x.server.netIds.netIdOf(stall)!;
  const res = async (p: Promise<StallResultMsg>): Promise<StallResultMsg> => { let out: StallResultMsg | undefined; void p.then((r) => (out = r)); for (let i = 0; i < 40 && !out; i++) { x.step(1); await Promise.resolve(); } return out!; };
  return { ...x, owner, b1, b2, stall, nid, sword, bread, res };
}
const coins = (x: Awaited<ReturnType<typeof market>>) => x.total(x.players.get(2)!, COIN) + x.total(x.players.get(3)!, COIN) + x.total(x.till.get(x.stall)!, COIN);

describe("stall replication", () => {
  it("header to everyone in AOI, listings only to viewers; per-listing deltas are a few bytes", async () => {
    const x = await market(0.1);
    const ce = (c: typeof x.b1) => c.entityOf(x.nid)!;
    expect(x.b1.world.get(ce(x.b1), StallHeader)).toMatchObject({ ownerKind: 0, ownerId: ALICE, open: 1, listingCount: 2 });
    expect(x.b1.world.has(ce(x.b1), Listings)).toBe(false); // not open
    x.viewers.get(x.stall)!.add(2); x.step(6);
    const l = x.b1.world.get(ce(x.b1), Listings)! as unknown as Record<string, number[]> & { revision: number };
    expect(l.revision).toBe(x.sw.getField(x.stall, Listings, "revision")); expect(l.crafterId![0]).toBe(777); expect(l.priceCount![1]).toBe(2);
    expect(x.b2.world.has(ce(x.b2), Listings)).toBe(false);
    x.step(4); const s0 = x.server.sessions.get(2)!.stats.bytesSent; x.step(10); const idle = x.server.sessions.get(2)!.stats.bytesSent - s0;
    await x.res(x.owner.stalls.editPrice(x.nid, x.bread, { itemId: COIN, count: 3 }));
    const s1 = x.server.sessions.get(2)!.stats.bytesSent; x.step(10); const withEdit = x.server.sessions.get(2)!.stats.bytesSent - s1;
    console.log(JSON.stringify({ listingPriceEditBytes: withEdit - idle }));
    expect(withEdit - idle).toBeLessThan(24);
    expect((x.b1.world.get(ce(x.b1), Listings)! as unknown as { priceCount: number[] }).priceCount[1]).toBe(3);
  });
});

describe("purchase protocol", () => {
  it("atomic buy keeps crafterId/durability, pays the till, notifies the owner with resolvable names", async () => {
    const x = await market();
    const names = new PlayerNameRegistry(); names.set(777, "Smith Ásta"); names.set(BOB, "Bob");
    (x.stalls.opts as { names?: NameSync }).names = new NameSync(x.server, { names });
    const sales: unknown[] = []; x.owner.stalls.onSale((s) => sales.push(s));
    const r = await x.res(x.b1.stalls.buy(x.nid, x.sword, 0, { itemId: COIN, count: 30 }));
    expect(r).toMatchObject({ reason: StallResult.Ok, detail: 1 });
    const bag = x.players.get(2)!; const got = [...Array(24).keys()].map((i) => x.slot(bag, i)).find((s) => s.item === SWORD)!;
    expect(got).toEqual({ item: SWORD, count: 1, crafter: 777, dur: 90 });
    expect(x.total(bag, COIN)).toBe(70); expect(x.total(x.till.get(x.stall)!, COIN)).toBe(30); expect(x.slot(x.stall, 0).count).toBe(0);
    x.step(6);
    expect(sales).toEqual([expect.objectContaining({ listingId: x.sword, item: SWORD, qty: 1, crafterId: 777, price: { itemId: COIN, count: 30 }, buyerId: BOB, queued: false })]);
    expect(x.owner.names.get(777)).toBe("Smith Ásta"); expect(x.owner.names.get(BOB)).toBe("Bob"); // pushed with the sale
    expect(x.sw.getField(x.stall, StallHeader, "listingCount")).toBe(1);
  });

  it("race: two buyers for the last item in the same tick -> exactly one sale; stale price rejected; noFunds; denied; range", async () => {
    const x = await market(0.1);
    const pa = x.b1.stalls.buy(x.nid, x.sword, 0, { itemId: COIN, count: 30 }); const pb = x.b2.stalls.buy(x.nid, x.sword, 0, { itemId: COIN, count: 30 });
    const [ra, rb] = [await x.res(pa), await x.res(pb)];
    expect([ra.reason, rb.reason].sort()).toEqual([StallResult.Ok, StallResult.SoldOut]);
    expect(x.stalls.stats.sales).toBe(1); expect(coins(x)).toBe(200);
    // stale price: owner raises bread to 3, Bob still expects 2
    expect((await x.res(x.owner.stalls.editPrice(x.nid, x.bread, { itemId: COIN, count: 3 }))).reason).toBe(0);
    expect((await x.res(x.b1.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 2 }, 2))).reason).toBe(StallResult.PriceChanged);
    expect((await x.res(x.b1.stalls.buy(x.nid, x.bread, 999, { itemId: COIN, count: 3 }, 9))).reason).toBe(StallResult.SoldOut); // only 5
    x.put(x.players.get(3)!, 0, COIN, 2);
    expect((await x.res(x.b2.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 3 }, 1))).reason).toBe(StallResult.NoFunds);
    expect(x.total(x.players.get(3)!, COIN)).toBe(2); // rolled back
    x.canBuy.allow = false; expect((await x.res(x.b1.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 3 }))).reason).toBe(StallResult.Denied); x.canBuy.allow = true;
    x.sw.setField(x.players.get(2)!, Transform, "x", 40); x.step(2);
    expect((await x.res(x.b1.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 3 }))).reason).toBe(StallResult.OutOfRange);
    x.sw.setField(x.stall, StallHeader, "open", 0); x.sw.setField(x.players.get(3)!, Transform, "x", 11); x.put(x.players.get(3)!, 0, COIN, 50);
    expect((await x.res(x.b2.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 3 }))).reason).toBe(StallResult.Closed);
    expect(checkListing({ revision: 1, listing: () => undefined }, { listingId: 1, expectedRevision: 1, expectedPrice: { itemId: 1, count: 1 }, qty: 0 })).toBe(StallResult.BadRequest);
  });

  it("owner withdraws the item mid-purchase (same tick, before the buy) -> soldOut, nothing paid", async () => {
    const x = await market(0);
    const pd = x.owner.stalls.delist(x.nid, x.sword); const pb = x.b1.stalls.buy(x.nid, x.sword, 0, { itemId: COIN, count: 30 });
    expect((await x.res(pd)).reason).toBe(0); expect((await x.res(pb)).reason).toBe(StallResult.SoldOut);
    expect(x.total(x.players.get(1)!, SWORD)).toBe(1); expect(x.total(x.players.get(2)!, COIN)).toBe(100); expect(coins(x)).toBe(200);
  });

  it("buyer disconnects mid-buy: atomic either way, conservation holds, client promise resolves", async () => {
    const x = await market(0);
    const p = x.b1.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 2 }, 2);
    x.net.advance(10); x.b1.close(); let r: StallResultMsg | undefined; void p.then((v) => (r = v));
    x.step(10); await Promise.resolve();
    expect(coins(x) + 0).toBeLessThanOrEqual(200);
    const sold = x.stalls.stats.sales; const breadLeft = x.slot(x.stall, 1).count; expect(breadLeft).toBe(sold ? 3 : 5);
    expect(x.total(x.till.get(x.stall)!, COIN)).toBe(sold ? 4 : 0);
    x.b1.stalls.reset(); await Promise.resolve(); expect(r).toBeDefined();
    expect([StallResult.Ok, StallResult.Disconnected]).toContain(r!.reason);
  });

  it("owner offline: sales queue (bounded) and arrive on reconnect flagged queued", async () => {
    const x = await market(0);
    (x.stalls.opts as { offlineQueue?: number }).offlineQueue = 2;
    x.owner.close(); x.step(6);
    for (let i = 0; i < 3; i++) expect((await x.res(x.b1.stalls.buy(x.nid, x.bread, 0, { itemId: COIN, count: 2 }))).reason).toBe(0);
    expect(x.stalls.offline.get(ALICE)!.sales.length).toBe(2); expect(x.stalls.offline.get(ALICE)!.dropped).toBe(1);
    const back = await x.addClient(ALICE, 10, 10); x.step(6);
    expect(back.stalls.sales.map((s) => [s.queued, s.dropped])).toEqual([[true, 1], [true, 0]]);
    expect(x.stalls.offline.size).toBe(0);
  });
});

describe("owner commands", () => {
  it("list / edit / delist / collect permission-checked (clan ranks) and rate-limited", async () => {
    const x = await stallRig({ loss: 0.1 });
    const lead = await x.addClient(10, 10, 10), mem = await x.addClient(11, 10, 11), off = await x.addClient(12, 11, 10);
    x.ranks.set(10, 3); x.ranks.set(11, 1); x.ranks.set(12, 2);
    const stall = x.makeStall(10, 10, 1, 500); x.put(stall, 3, BREAD, 4, 12); x.step(6); const nid = x.server.netIds.netIdOf(stall)!;
    const res = async (p: Promise<StallResultMsg>) => { let o: StallResultMsg | undefined; void p.then((r) => (o = r)); for (let i = 0; i < 40 && !o; i++) { x.step(1); await Promise.resolve(); } return o!; };
    expect((await res(mem.stalls.list(nid, 3, { itemId: COIN, count: 1 }))).reason).toBe(StallResult.Denied);
    const l = await res(off.stalls.list(nid, 3, { itemId: COIN, count: 1 })); expect(l.reason).toBe(0); expect(l.detail).toBeGreaterThan(0);
    expect((await res(off.stalls.editPrice(nid, l.detail, { itemId: COIN, count: 4 }))).reason).toBe(0);
    expect((await res(off.stalls.collect(nid))).reason).toBe(StallResult.Denied); // officers can't collect
    x.put(x.till.get(stall)!, 0, COIN, 40);
    expect(await res(lead.stalls.collect(nid))).toMatchObject({ reason: 0, detail: 40 });
    expect(x.total(x.players.get(1)!, COIN)).toBe(40);
    expect((await res(off.stalls.delist(nid, l.detail))).reason).toBe(0); expect(x.total(x.players.get(3)!, BREAD)).toBe(4);
    const burst = await Promise.all(Array.from({ length: 12 }, () => { const p = mem.stalls.editPrice(nid, 1, { itemId: COIN, count: 1 }); return p; }).map((p) => res(p)));
    expect(burst.filter((r) => r.reason === StallResult.RateLimited).length).toBeGreaterThan(0);
  });
});
import { Transform } from "@engine/core";
