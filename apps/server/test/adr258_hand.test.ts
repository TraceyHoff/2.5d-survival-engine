import { describe, expect, it } from "vitest";
import { World, Transform, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { Health, ResourceNode, spawnResourceNode, spawnAnimal, spawnZombie, gameplayDefs, markReady, Dead } from "@engine/gameplay";
import { createGameServer } from "../src/game.js";
import { Act, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/protocol.js";

async function rig() {
  const net = new LoopbackNetwork(3), gs = createGameServer({ transport: net.createServer(), seed: 5, population: false });
  let buttons = 0; const w = new World({ seed: 1 }); installDemoWorld(w, "client");
  const client = new NetClient({ world: w, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS,
    sampleInput: () => ({ buttons, aimX: 1, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
  const p = client.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p;
  const player = gs.players.get(client.clientId)!.entity; markReady(gs.world, player);
  const tick = (n = 1, victim?: Entity): void => { for (let i = 0; i < n; i++) {
    if (victim !== undefined && gs.world.isAlive(victim)) { const t = gs.world.get(player, Transform)!; gs.world.set(victim, Transform, { x: t.x + 0.8, y: t.y, z: t.z }); }
    net.advance(50); gs.step(1 / 20); w.step(1 / 20); client.pollEvents(Infinity);
  } };
  tick(10); return { gs, player, tick, set: (v: number) => { buttons = v; }, close: async () => { client.close(); await gs.shutdown(); } };
}
describe("ADR-258 hand is not an attack", () => {
  for (const kind of ["animal", "zombie"] as const) it(`hand/gather never damages a nearby ${kind}; dedicated attack still does`, async () => {
    const r = await rig(); const w = r.gs.world;
    try {
      const t = w.get(r.player, Transform)!;
      const victim = kind === "animal" ? spawnAnimal(w, 0, t.x + 0.8, t.y) : spawnZombie(w, [...gameplayDefs(w).zombies.values()][0]!.id, t.x + 0.8, t.y);
      const hp = w.get(victim, Health)!.hp;
      r.set(Act.Gather); r.tick(25, victim); expect(w.get(victim, Health)!.hp).toBe(hp);
      // Even overlapping attack + hand inputs must favour safe interaction.
      r.set(Act.Gather | Act.Attack); r.tick(10, victim); expect(w.get(victim, Health)!.hp).toBe(hp);
      r.set(Act.Attack); r.tick(25, victim); expect(w.has(victim, Dead) || w.get(victim, Health)!.hp < hp).toBe(true);
    } finally { await r.close(); }
  });
  it("the hand still gathers nodes with a creature in reach, without damaging that creature", async () => {
    const r = await rig(); const w = r.gs.world;
    try {
      const t = w.get(r.player, Transform)!; const animal = spawnAnimal(w, 0, t.x + 0.8, t.y);
      const node = spawnResourceNode(w, "fallen_branches", t.x + 0.5, t.y); w.setField(node, Transform, "z", t.z);
      const amount = w.get(node, ResourceNode)!.amount, hp = w.get(animal, Health)!.hp;
      r.set(Act.Gather); r.tick(40, animal);
      expect(w.get(animal, Health)!.hp).toBe(hp);
      expect(!w.isAlive(node) || w.get(node, ResourceNode)!.amount < amount).toBe(true);
    } finally { await r.close(); }
  });
});
