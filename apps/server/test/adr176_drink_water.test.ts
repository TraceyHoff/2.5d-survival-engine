import { describe, it, expect } from "vitest";
import { Transform, World } from "@engine/core";
import { addItem, defaultDefs, writeSlots, NO_SLOT, readSlots, Survival, UseCmd, WATER_TILE_THIRST, Equipment, farmPrompt, CONSUME_COOLDOWN_TICKS } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5 });
  const world = new World({ seed: 1 }); installDemoWorld(world, "client");
  const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); c.world.step(1 / 20); c.pollEvents(Infinity); } };
  const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p;
  c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
  const e = gs.players.get(c.clientId!)!.entity; tick(5);
  // walk the spawn spiral for a water tile (id 1) and stand on the land tile beside it
  const me = gs.world.get(e, Transform)!; let spot: { x: number; y: number } | undefined;
  for (let r = 1; r < 400 && !spot; r++) for (let dx = -r; dx <= r && !spot; dx++) for (const dy of [-r, r]) {
    const tx = Math.floor(me.x + dx), ty = Math.floor(me.y + dy);
    if (gs.chunks.getTile(tx, ty) === 1 && gs.chunks.getTile(tx - 1, ty) !== 1) { spot = { x: tx - 0.6, y: ty + 0.5 }; break; }
  }
  expect(spot).toBeDefined();
  gs.world.set(e, Transform, { x: spot!.x, y: spot!.y, z: 0 }); tick(10);
  return { gs, c, e, tick };
}

describe("ADR-176 drinking works on the authoritative server", () => {
  it("UseCmd NO_SLOT next to a water tile raises thirst on the server (was silently ignored: no TerrainRes)", async () => {
    const { gs, c, e, tick } = await setup();
    gs.world.setField(e, Survival, "thirst", 40); tick(1);
    c.sendCommand(gameplayNet(UseCmd), { slot: NO_SLOT } as never); tick(4);
    expect(gs.world.get(e, Survival)!.thirst).toBeGreaterThan(40 + WATER_TILE_THIRST - 1);
  });
  it("an empty canteen refills at the water, then drinking it hydrates", async () => {
    const { gs, c, e, tick } = await setup(); const d = defaultDefs();
    addItem(gs.world, e, d.itemId("canteen"), 1); tick(2);
    const slot = findSlot(gs, e, d.itemId("canteen"));
    { const v = readSlots(gs.world, e); v.put(slot, v.item(slot), v.count(slot), v.created(slot), 0); writeSlots(gs.world, e, v, d); } // empty canteen
    const fill0 = readSlots(gs.world, e).durability(slot);
    c.sendCommand(gameplayNet(UseCmd), { slot } as never); tick(4);
    expect(readSlots(gs.world, e).durability(slot)).toBeGreaterThan(fill0);
    gs.world.setField(e, Survival, "thirst", 30); tick(CONSUME_COOLDOWN_TICKS + 2);
    c.sendCommand(gameplayNet(UseCmd), { slot } as never); tick(4);
    expect(gs.world.get(e, Survival)!.thirst).toBeGreaterThan(30);
  });
  it("the Drink water prompt shows even while holding a tool", async () => {
    const { gs, e, tick } = await setup(); const d = defaultDefs();
    addItem(gs.world, e, d.itemId("stone_axe"), 1); tick(1);
    gs.world.set(e, Equipment, { mainHandSlot: findSlot(gs, e, d.itemId("stone_axe")) }); tick(1);
    expect(farmPrompt(gs.world, e)).toMatchObject({ action: "Drink", slot: NO_SLOT, label: "Drink water" });
  });
});
function findSlot(gs: { world: World }, e: number, item: number): number { const s = readSlots(gs.world, e); for (let i = 0; i < 32; i++) if (s.item(i) === item) return i; throw new Error("no slot"); }
