import { describe, expect, it } from "vitest";
import { Transform } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

describe("player facing turns smoothly", () => {
  it("turnFacing caps the turn rate and takes the shortest way round", () => {
    expect(G.turnFacing(0, Math.PI, 1 / 20)).toBeCloseTo(G.PLAYER_TURN_RATE / 20, 9);
    expect(G.turnFacing(0, Math.PI, 1)).toBeCloseTo(Math.PI, 9);
    expect(G.turnFacing(0, -Math.PI / 2, 1 / 20)).toBeCloseTo(-G.PLAYER_TURN_RATE / 20, 9);
    // across the ±π seam: 170° -> -170° is a 20° turn, not 340° (result wraps past π, so compare modulo 2π)
    const seam = G.turnFacing((170 * Math.PI) / 180, (-170 * Math.PI) / 180, 1);
    expect(Math.atan2(Math.sin(seam), Math.cos(seam))).toBeCloseTo((-170 * Math.PI) / 180, 9);
  });
  it("applyMovementInput moves at full speed at once but eases facing toward the move direction", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 20, y: 20 });
    w.set(p, Transform, { facing: 0 });
    // MoveUp = up-screen = world (-1, -1) normalised, so the facing target is -3π/4, a 135° turn from 0
    const target = Math.atan2(-1, -1);
    G.applyMovementInput(w, p, G.GameplayActions.MoveUp, 1 / 20);
    const a1 = w.get(p, Transform)!;
    expect(a1.facing).toBeCloseTo(-G.PLAYER_TURN_RATE / 20, 9); // one tick of turning, not the full snap
    expect(Math.hypot(a1.x - 20, a1.y - 20)).toBeGreaterThan(0); // position still moves at full speed
    for (let i = 0; i < 60; i++) G.applyMovementInput(w, p, G.GameplayActions.MoveUp, 1 / 20);
    expect(w.get(p, Transform)!.facing).toBeCloseTo(target, 6);
  });
});
