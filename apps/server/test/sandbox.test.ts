import { describe, it, expect } from "vitest";
import { Transform, World } from "@engine/core";
import { countItem, itemIdSafe, Animal, speciesOfAnimal, petSpeciesOfKey } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { SANDBOX_KIT, SANDBOX_PET_KIT } from "../src/sandbox.js";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { DevPetKit } from "../src/protocol.js";

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
  return { gs, tick, connect, clients };
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

describe("ADR-145 sandbox pet kit (DevPetKit)", { timeout: 30_000 }, () => {
  const dogsNear = (w: World, at: { x: number; y: number }): number => [...w.query([Animal, Transform])].filter((e) => speciesOfAnimal(w, e) === petSpeciesOfKey("dog_dachshund") && Math.hypot(w.get(e, Transform)!.x - at.x, w.get(e, Transform)!.y - at.y) < 1.6).length;
  for (const on of [true, false]) it(on ? "grants treats + a dachshund next to the sender" : "is ignored without DEV_SANDBOX", async () => {
    const { gs, tick, connect, clients } = await setup(on); await connect(); tick(2);
    const p = [...gs.players.values()][0]!; const at = { ...gs.world.get(p.entity, Transform)! }; const before = dogsNear(gs.world, at);
    clients[0]!.sendCommand(DevPetKit, { v: 1 }); tick(3);
    for (const k of SANDBOX_PET_KIT) expect([k, countItem(gs.world, p.entity, itemIdSafe(gs.world, k)!)]).toEqual([k, on ? 5 : 0]);
    expect(dogsNear(gs.world, at) - before).toBe(on ? 1 : 0);
  });
});

describe("ADR-142 sandbox kit covers the QA stations", () => {
  it("has the cost of an anvil and a blanket market stall", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync(new URL("../../../packages/gameplay/data/pieces.json", import.meta.url), "utf8")) as { pieces: { key: string; cost?: { resource: string; amount: number }[] }[] };
    const kit = new Map(SANDBOX_KIT);
    for (const k of ["anvil", "stall_blanket", "campfire", "workbench"]) for (const c of raw.pieces.find((p) => p.key === k)!.cost ?? []) expect([k, c.resource, (kit.get(c.resource) ?? 0) >= c.amount]).toEqual([k, c.resource, true]);
  });
});
