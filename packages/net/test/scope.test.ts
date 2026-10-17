import { describe, expect, it } from "vitest";
import { Owner, Transform, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { Chest, Secret, ServerOnly, frames, join, makeWorld } from "./fixture.js";

async function setup() {
  const net = new LoopbackNetwork(5); const sw = makeWorld();
  const players = new Map<number, Entity>();
  const viewers = new Set<number>();
  const server = new NetServer({ world: sw, transport: net.createServer(), onClientJoin: (s, w) => {
    const e = w.create(); w.add(e, Transform, { x: s.clientId, y: 0 }).add(e, Owner, { clientId: s.clientId }).add(e, Secret, { gold: 100 + s.clientId }); players.set(s.clientId, e);
  } });
  server.setScope(Secret, "owner").setScope(ServerOnly, "none").setScope(Chest, (_w, _e, clientId) => viewers.has(clientId));
  const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 20 }) });
  const B = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 20 }) });
  await join(net, A); await join(net, B);
  const step = (n = 1) => frames(net, [sw, A.world, B.world], n);
  return { net, sw, server, A, B, players, viewers, step };
}

describe("replication scope", () => {
  it("owner-scoped components reach only the owner; 'none' never; viewer hook gates containers", async () => {
    const { sw, server, A, B, players, viewers, step } = await setup();
    const chest = sw.create(); sw.add(chest, Transform, { x: 3, y: 3 }).add(chest, Chest, { items: 7 }).add(chest, ServerOnly, { v: 1 });
    step(6);
    expect(server.getScope(Secret)).toBe("owner");
    const aSelf = A.entityOf(sw.getField(players.get(1)!, Transform, "x") !== undefined ? server.netIds.netIdOf(players.get(1)!)! : 0)!;
    const bOnA = A.entityOf(server.netIds.netIdOf(players.get(2)!)!)!;
    expect(A.world.get(aSelf, Secret)?.gold).toBe(101);
    expect(A.world.has(bOnA, Secret)).toBe(false);
    const chestA = A.entityOf(server.netIds.netIdOf(chest)!)!;
    expect(A.world.has(chestA, Chest)).toBe(false);
    expect(A.world.has(chestA, ServerOnly)).toBe(false);
    viewers.add(1); sw.setField(chest, Chest, "items", 8); step(4); // open container for client 1
    expect(A.world.get(chestA, Chest)?.items).toBe(8);
    expect(B.world.has(B.entityOf(server.netIds.netIdOf(chest)!)!, Chest)).toBe(false);
    viewers.delete(1); sw.setField(chest, Chest, "items", 9); step(4); // closed: removed again
    expect(A.world.has(chestA, Chest)).toBe(false);
  });

  it("ownership change on a live entity moves owner-scoped state and prediction to the new owner", async () => {
    const { sw, server, A, B, players, step } = await setup();
    step(6);
    const e = players.get(1)!; const id = server.netIds.netIdOf(e)!;
    const onA = A.entityOf(id)!, onB = B.entityOf(id)!;
    expect(A.owned.has(id)).toBe(true); expect(A.world.predicted.has(onA)).toBe(true);
    expect(B.world.has(onB, Secret)).toBe(false);
    sw.setField(e, Owner, "clientId", 2); // transfer; Secret itself did not change
    step(6);
    expect(A.owned.has(id)).toBe(false); expect(A.world.predicted.has(onA)).toBe(false);
    expect(A.world.has(onA, Secret)).toBe(false);
    expect(B.owned.has(id)).toBe(true); expect(B.world.predicted.has(onB)).toBe(true);
    expect(B.world.get(onB, Secret)?.gold).toBe(101); // full owner-scoped state sent to the new owner
    expect(B.owned.size).toBe(2);
  });
});
