import { describe, it, expect } from "vitest";
import { PlayerId, Transform, World, type Entity } from "@engine/core";
import { readFileSync } from "node:fs";
import { addItem, applyDamage, Dead, deathBagsOf, defaultDefs, dropItem, LootBag, PVP, RespawnCmd } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

const d = defaultDefs(); const PLANK = d.itemId("planks");
async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5 });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async () => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    const e = gs.players.get(c.clientId!)!.entity; return { c, e, pid: gs.world.getField(e, PlayerId, "id")! };
  };
  return { gs, tick, connect };
}
const T = (n: number) => Math.ceil(n * 20);
const bagsNear = (w: World, x: number, y: number): Entity[] =>
  [...w.query([LootBag, Transform])].filter((e) => { const t = w.get(e, Transform)!; return Math.hypot(t.x - x, t.y - y) < 0.5; });

/** ADR-166: bags (death bag, zombie/dropped loot) must stay replicated AND drawable after die -> respawn. */
async function dieRespawnWalkBack(nClients: 1 | 2) {
  const { gs, tick, connect } = await setup(); const w = gs.world;
  const A = await connect(); const B = nClients === 2 ? await connect() : undefined; tick(5);
  const a0 = { ...w.get(A.e, Transform)! };
  if (B) { w.set(B.e, Transform, { x: a0.x + 2, y: a0.y, z: 0 }); tick(10); }
  // an ownerless loot bag (zombie-style) that exists before the death
  addItem(w, A.e, PLANK, 3, A.pid); const pre = dropItem(w, A.e, PLANK, 3)!; w.setField(pre, LootBag, "owner", 0); tick(3);
  const pt = { ...w.get(pre, Transform)! };
  addItem(w, A.e, PLANK, 7, A.pid); tick(2);
  applyDamage(w, A.e, 1e6, A.e); tick(T(PVP.respawnSeconds) + 3);
  const death = deathBagsOf(w, A.pid)[0]!; expect(death).toBeDefined();
  A.c.sendCommand(gameplayNet(RespawnCmd), {} as never); tick(5); expect(w.has(A.e, Dead)).toBe(false);
  // walk back to the death spot, then a fresh bag drops after respawn
  w.set(A.e, Transform, { x: death.x + 1, y: death.y, z: 0 }); tick(15);
  addItem(w, A.e, PLANK, 2, A.pid); const post = dropItem(w, A.e, PLANK, 2)!; tick(5); const qt = { ...w.get(post, Transform)! };
  for (const c of [A.c, ...(B ? [B.c] : [])]) {
    expect(bagsNear(c.world, death.x, death.y).length, "death bag").toBeGreaterThan(0);
    expect(bagsNear(c.world, pt.x, pt.y).length, "pre-death loot").toBeGreaterThan(0);
    expect(bagsNear(c.world, qt.x, qt.y).length, "post-respawn loot").toBeGreaterThan(0);
  }
}

describe("ADR-166 loot bags stay visible after die -> respawn", () => {
  it("single player: death bag, old and new loot bags replicate after respawn", async () => { await dieRespawnWalkBack(1); });
  it("two clients: both see every bag after A respawns", async () => { await dieRespawnWalkBack(2); });
  it("the client view draws every LootBag with the pack's bag sprite (bags were label-only before)", () => {
    const v = readFileSync("apps/client/src/view.ts", "utf8");
    expect(v).toMatch(/if \(net\.has\(e, LootBag\)\) \{[^\n]*\n\s*const r = this\.rs\(LOOT_BAG_SPRITE\)/);
    const key = /LOOT_BAG_SPRITE = "([^"]+)"/.exec(v)![1];
    const m = JSON.parse(readFileSync("packages/assets/pack/manifest.json", "utf8")) as { sprites: { key: string }[] };
    expect(m.sprites.some((s) => s.key === key)).toBe(true);
  });
});
