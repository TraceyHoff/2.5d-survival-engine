import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { CHUNK_SIZE } from "@engine/world";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { Buff, frames, join, makeWorld } from "./fixture.js";

/** Player blink report: the client's own entity must never be despawned / respawned by AOI changes, linger expiry or
 *  the snapshot byte budget, however far and long it travels through a crowded world. */
describe("local player entity is never despawned", () => {
  it("survives minutes of chunk crossings under a tight snapshot budget with many entities", async () => {
    const net = new LoopbackNetwork(11); const sw = makeWorld(); let me: Entity | undefined;
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: { radius: 1, hysteresis: 1 }, budgetBytes: 512,
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 1, y: 1 }).add(e, Owner, { clientId: s.clientId }); me = e; } });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 30 }) });
    const ownDespawns: number[] = []; (A as unknown as { opts: { onDespawn?: (e: Entity, id: number) => void } }).opts.onDespawn = (_e, id) => { if (A.owned.has(id)) ownDespawns.push(id); };
    await join(net, A);
    for (let i = 0; i < 400; i++) { const m = sw.create(); sw.add(m, Transform, { x: (i % 40) * 3, y: Math.floor(i / 40) * 3 }).add(m, Buff, { power: i, kind: 1 }); }
    frames(net, [sw, A.world], 10);
    const id = server.netIds.netIdOf(me!)!; const first = A.entityOf(id); expect(first).toBeDefined();
    for (let t = 0; t < server.tickHz * 180; t += 4) { // ~3 min: a lap around the crowd, crossing chunk edges
      const a = t / (server.tickHz * 30); sw.setField(me!, Transform, "x", 60 + Math.cos(a) * 3 * CHUNK_SIZE); sw.setField(me!, Transform, "y", 15 + Math.sin(a) * 3 * CHUNK_SIZE);
      frames(net, [sw, A.world], 4);
      expect(A.entityOf(id)).toBe(first);
    }
    expect(ownDespawns).toEqual([]);
  }, 60000);
});
