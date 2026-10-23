import { describe, expect, it } from "vitest";
import { Transform, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

describe("server.onTick write phase (regression: writes used to run after capture and were lost to the bit clear)", () => {
  it("component writes and entity creation inside onTick replicate", async () => {
    const net = new LoopbackNetwork(5); const sw = makeWorld();
    const server = new NetServer({ world: sw, transport: net.createServer(), interest: false });
    const A = new NetClient({ world: makeWorld(), transport: net.createClient({ latencyMs: 20 }) }); await join(net, A);
    const e = sw.create(); sw.add(e, Transform, { x: 1, y: 77 });
    frames(net, [sw, A.world], 6);
    const onA = () => A.entityOf(server.netIds.netIdOf(e)!);
    expect(A.world.get(onA()!, Transform)!.x).toBe(1);
    let spawned: Entity | undefined; let n = 0;
    server.onTick(() => { if (++n === 1) { sw.get(e, Transform)!.x = 0; sw.set(e, Transform, { x: 42, y: 77 }); spawned = sw.create(); sw.add(spawned, Transform, { x: 9, y: 88 }); } });
    frames(net, [sw, A.world], 6);
    expect(A.world.get(onA()!, Transform)!.x).toBe(42);
    const id = server.netIds.netIdOf(spawned!); expect(id).toBeDefined();
    expect(A.world.get(A.entityOf(id!)!, Transform)!.y).toBe(88);
  });
});
