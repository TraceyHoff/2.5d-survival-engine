import { describe, it, expect } from "vitest";
import { Transform, World, AnimState as Anim } from "@engine/core";
import { AnimState, GameplayActions as A, inWater, swimSpeedMulAt, movementBlocked, TerrainRes, terrainFromTileMap, applyMovementInput, defaultDefs } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5 });
  const world = new World({ seed: 1 }); installDemoWorld(world, "client");
  const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); c.world.step(1 / 20); c.pollEvents(Infinity); } };
  const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p;
  c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
  const e = gs.players.get(c.clientId!)!.entity; tick(5);
  const me = gs.world.get(e, Transform)!; let spot: { x: number; y: number } | undefined;
  const water = (x: number, y: number): boolean => { for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (gs.chunks.getTile(x + i, y + j) !== 1) return false; return true; };
  for (let r = 1; r < 400 && !spot; r++) for (let dx = -r; dx <= r && !spot; dx++) for (const dy of [-r, r]) {
    const tx = Math.floor(me.x + dx), ty = Math.floor(me.y + dy); if (water(tx, ty)) { spot = { x: tx + 0.5, y: ty + 0.5 }; break; }
  }
  expect(spot).toBeDefined();
  gs.world.set(e, Transform, { x: spot!.x, y: spot!.y, z: 0 }); tick(20);
  return { gs, c, e, tick, spot: spot! };
}

describe("ADR-178 swimming on the authoritative server", () => {
  it("server sees water: inWater, swim speed multiplier, Swim anim", async () => {
    const { gs, e, tick, spot } = await setup();
    expect(inWater(gs.world, spot.x, spot.y)).toBe(true);
    expect(swimSpeedMulAt(gs.world, spot.x, spot.y)).toBeLessThan(1);
    if (gs.world.has(e, AnimState)) gs.world.set(e, AnimState, { anim: Anim.Walk, startTick: gs.world.tick }); else gs.world.add(e, AnimState, { anim: Anim.Walk, startTick: gs.world.tick }); tick(2);
    expect(gs.world.get(e, AnimState)!.anim).toBe(Anim.Swim);
  });
  it("a swimming player moves at swimSpeedMul; non-swimmers are blocked by water", async () => {
    const { gs, e, spot } = await setup();
    const x0 = gs.world.get(e, Transform)!.x; applyMovementInput(gs.world, e, A.MoveRight, 0.05);
    const dWater = gs.world.get(e, Transform)!.x - x0;
    gs.world.set(e, Transform, { x: 0.5, y: 0.5, z: 0 }); // compare against an unrestricted step with no terrain lookup
    const t = gs.world.getResource(TerrainRes)!; gs.world.setResource(TerrainRes, { tileAt: () => 3, heightAt: () => 0 });
    applyMovementInput(gs.world, e, A.MoveRight, 0.05); const dLand = gs.world.get(e, Transform)!.x - 0.5; gs.world.setResource(TerrainRes, t);
    expect(dWater / dLand).toBeCloseTo(defaultDefs().movement.swimSpeedMul, 2);
    expect(movementBlocked(gs.world, spot.x - 1, spot.y, spot.x, spot.y, 0, false)).toBe(true);
  });
  it("client replica terrain over replicated tiles agrees with the server (prediction parity)", async () => {
    const { gs, c, spot } = await setup();
    c.world.setResource(TerrainRes, terrainFromTileMap(c.tiles.tiles));
    expect(inWater(c.world, spot.x, spot.y)).toBe(inWater(gs.world, spot.x, spot.y));
    expect(swimSpeedMulAt(c.world, spot.x, spot.y)).toBe(swimSpeedMulAt(gs.world, spot.x, spot.y));
  });
});
