import { describe, it, expect } from "vitest";
import { Transform, World } from "@engine/core";
import { countItem, itemIdSafe } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { SANDBOX_KIT } from "../src/sandbox.js";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

async function setup(devSandbox: boolean) {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), seed: 77, devSandbox });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (): Promise<void> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const client = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd, 1 / 20) });
    const p = client.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(client);
  };
  return { gs, tick, connect };
}

describe("ADR-140 dev sandbox", { timeout: 30_000 }, () => {
  it("gives every joiner the kit and spawns them side by side; off by default", async () => {
    const { gs, tick, connect } = await setup(true); await connect(); tick(2); await connect(); tick(2);
    const ps = [...gs.players.values()]; expect(ps).toHaveLength(2);
    const planks = itemIdSafe(gs.world, "sticks")!, meat = itemIdSafe(gs.world, "cooked_meat")!;
    for (const p of ps) { expect(countItem(gs.world, p.entity, planks)).toBeGreaterThan(0); expect(countItem(gs.world, p.entity, meat)).toBeGreaterThan(0); }
    for (const [k, n] of SANDBOX_KIT) expect([k, countItem(gs.world, ps[0]!.entity, itemIdSafe(gs.world, k)!)]).toEqual([k, n]);
    const [a, b] = ps.map((p) => gs.world.get(p.entity, Transform)!); expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeLessThan(4);
    const off = await setup(false); await off.connect(); off.tick(2);
    const p0 = [...off.gs.players.values()][0]!; expect(countItem(off.gs.world, p0.entity, planks)).toBe(0);
  });
});
