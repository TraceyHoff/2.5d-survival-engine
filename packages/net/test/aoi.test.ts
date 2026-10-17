import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { CHUNK_SIZE } from "@engine/world";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { Buff, frames, join, makeWorld } from "./fixture.js";

{
  describe("area of interest over loopback (world InterestGrid)", () => {
    it("despawns entities leaving AOI, re-sends a full spawn on re-entry, keeps globals + environment", async () => {
      const net = new LoopbackNetwork(2); const sw = makeWorld();
      const server = new NetServer({ world: sw, transport: net.createServer(), interest: { radius: 1, hysteresis: 1 },
        onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 1, y: 1 }).add(e, Owner, { clientId: s.clientId }); } });
      const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 10 }) });
      await join(net, A);
      const mob = sw.create(); sw.add(mob, Transform, { x: 10, y: 10 }).add(mob, Buff, { power: 3, kind: 1 });
      const global = sw.create(); sw.add(global, Buff, { power: 1, kind: 9 }); // no Transform => global
      const step = (n: number) => frames(net, [sw, A.world], n);
      step(5);
      const id = server.netIds.netIdOf(mob)!;
      const seen = (): Entity | undefined => A.entityOf(id);
      expect(seen()).toBeDefined();
      expect(A.entityOf(server.netIds.netIdOf(global)!)).toBeDefined();
      expect(A.entityOf(1)).toBe(A.world.environment);
      sw.setField(mob, Transform, "x", 4 * CHUNK_SIZE); step(5); // 4 chunks away > r+h
      expect(seen()).toBeUndefined();
      sw.setField(mob, Buff, "kind", 2); // changes while out of AOI
      sw.setField(mob, Transform, "x", 20); step(5);
      const back = seen()!; expect(back).toBeDefined();
      expect(A.world.get(back, Buff)?.kind).toBe(2); // full spawn with current state
    });
  });
}

describe("multi-viewpoint AOI", () => {
  it("unions every owned entity and extra server-set viewpoints", async () => {
    const net = new LoopbackNetwork(5); const sw = makeWorld();
    const far = 10 * CHUNK_SIZE;
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: { radius: 1, hysteresis: 0 },
      onClientJoin: (s, w) => { for (const x of [1, far]) { const e = w.create(); w.add(e, Transform, { x, y: 1 }).add(e, Owner, { clientId: s.clientId }); } } });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient() });
    await join(net, A);
    const mk = (x: number) => { const e = sw.create(); sw.add(e, Transform, { x, y: 5 }); return e; };
    const nearA = mk(5), nearB = mk(far + 5), cam = mk(20 * CHUNK_SIZE + 5);
    const sees = (e: Entity) => A.entityOf(server.netIds.netIdOf(e) ?? -1) !== undefined;
    frames(net, [sw, A.world], 5);
    expect(sees(nearA)).toBe(true); expect(sees(nearB)).toBe(true); expect(sees(cam)).toBe(false);
    server.setViewpoints(1, [{ x: 20 * CHUNK_SIZE, y: 1, r: 0 }]); frames(net, [sw, A.world], 5);
    expect(sees(cam)).toBe(true);
    server.setViewpoints(1, []); frames(net, [sw, A.world], 5);
    expect(sees(cam)).toBe(false); expect(sees(nearB)).toBe(true);
  });
});

describe("bandwidth budget", () => {
  it("spreads a large join over several ticks, nearest first, owned entity always in the first snapshot", async () => {
    const net = new LoopbackNetwork(4); const sw = makeWorld();
    const server = new NetServer({ world: sw, transport: net.createServer(), budgetBytes: 600, interest: { radius: 2 },
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0.5, y: 0.5 }).add(e, Owner, { clientId: s.clientId }); } });
    for (let i = 0; i < 300; i++) { const e = sw.create(); sw.add(e, Transform, { x: (i % 30) * 2 + 1, y: Math.floor(i / 30) * 2 + 1 }); }
    const A = new NetClient({ world: makeWorld(), transport: net.createClient() });
    await join(net, A);
    frames(net, [sw, A.world], 1); net.advance(1); A.world.step(1 / 20);
    const s = server.sessions.get(1)!;
    expect(s.lastSnapshotBytes).toBeLessThanOrEqual(600 + 64);
    expect(A.owned.size).toBe(1);
    const first = A.entities.size;
    expect(first).toBeGreaterThan(5); expect(first).toBeLessThan(150);
    // nearest entities came first
    const far = [...A.entities.values()].map((e) => A.world.get(e, Transform)).filter((t) => t).map((t) => Math.hypot(t!.x, t!.y));
    expect(Math.max(...far)).toBeLessThan(30);
    frames(net, [sw, A.world], 40);
    expect(A.entities.size).toBe(302); // 300 + own + environment
    expect(s.stats.deferred).toBeGreaterThan(0);
  });
});

describe("@engine/testkit harness on net loopback", () => {
  it("createHarness connects clients and replicates over the loopback link", async () => {
    const { createHarness } = await import("@engine/testkit");
    const { applyInput, BTN_RIGHT } = await import("./fixture.js");
    const h = await createHarness({ clients: 2, makeWorld: () => makeWorld(), applyInput, link: { latencyMs: 30, jitterMs: 10, loss: 0.05 },
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: s.clientId * 3, y: 1 }).add(e, Owner, { clientId: s.clientId }); } });
    h.clients[0]!.input.buttons = BTN_RIGHT;
    h.tick(30);
    for (const c of h.clients) { expect(c.client.owned.size).toBe(1); expect(c.client.entities.size).toBe(3); }
    const a = h.clients[0]!.client; const self = a.entityOf([...a.owned][0]!)!;
    expect(h.clients[0]!.world.getField(self, Transform, "x")!).toBeGreaterThan(3 + 2);
  });
});
