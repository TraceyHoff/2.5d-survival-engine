import { describe, expect, it } from "vitest";
import { Transform } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

// ADR-125: slower on-foot movement so vehicles are worth using.
describe("ADR-125 player speed tuning", () => {
  const mv = G.defaultDefs().movement;
  const walk = mv.walkSpeed, sprint = mv.walkSpeed * mv.sprintMul;
  it("walk is a jog (~2.5-3 tiles/s) and sprint ~30-35% below the old 6.4", () => {
    expect(walk).toBeGreaterThanOrEqual(2.4); expect(walk).toBeLessThanOrEqual(3);
    expect(sprint / 6.4).toBeGreaterThan(0.6); expect(sprint / 6.4).toBeLessThan(0.7);
    expect(walk * mv.swimSpeedMul).toBeGreaterThan(0.9); // swimming still usable
  });
  it("motor vehicles are 3-6x sprint; zombie runners stay escapable but not trivial", () => {
    for (const d of G.VEHICLE_DEFS) if (d.class !== "bicycle" && d.class !== "trailer") {
      expect(d.maxSpeed / sprint).toBeGreaterThanOrEqual(3); expect(d.maxSpeed / sprint).toBeLessThanOrEqual(6);
    }
    const zs = [...G.defaultDefs().zombies.values()];
    const runner = zs.find((z) => z.key === "zombie_runner")!;
    expect(runner.speed).toBeLessThan(sprint); expect(runner.speed).toBeGreaterThan(walk); // outrun only by sprinting
    for (const z of zs) expect(z.speed).toBeLessThan(sprint);
  });
  it("applyMovementInput moves at the shared walk / sprint constants (server == client prediction)", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 20, y: 20 });
    const dir = G.GameplayActions.MoveUp; const { dx, dy } = G.moveDirection(dir); const k = Math.hypot(dx, dy);
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
    const a0 = { ...w.get(p, Transform)! }; G.applyMovementInput(w, p, dir, 1);
    expect(d(a0, w.get(p, Transform)!)).toBeCloseTo(k * walk * G.speedMultiplier(w, p, false), 4);
    const a1 = { ...w.get(p, Transform)! }; G.applyMovementInput(w, p, dir | G.GameplayActions.Sprint, 1);
    expect(d(a1, w.get(p, Transform)!)).toBeCloseTo(k * walk * G.speedMultiplier(w, p, true), 4);
  });
  it("walk anim playback scales with walk speed (no foot sliding)", () => {
    expect(G.walkAnimRate(makeWorld())).toBeCloseTo(mv.walkSpeed / mv.walkAnimRefSpeed, 6);
    expect(mv.walkAnimRefSpeed).toBe(4);
  });
});
