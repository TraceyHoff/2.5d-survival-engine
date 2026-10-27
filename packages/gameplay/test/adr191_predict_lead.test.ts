import { describe, it, expect } from "vitest";
import { evaluate, type World } from "@engine/core";
import { Buffs, Stat, defaultDefs, placePiece, predictContactSlow, snapPlacement, spawnPlayer } from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = defaultDefs();
function spike(w: World, x: number, y: number) {
  const b = spawnPlayer(w, { x: 40, y: 40 });
  const sn = snapPlacement(w, { piece: d.pieceId("barricade_spiked"), x, y, level: 0, rot: 0, tier: 0, variant: 0 });
  if (typeof sn === "number") throw new Error("snap");
  return placePiece(w, b, sn, { pay: false });
}

describe("ADR-191 prediction lead", () => {
  it("simTick adds predictLead only for live (non-replay) predicted entities", () => {
    const w = makeWorld(); const a = spawnPlayer(w, { x: 1, y: 1 }); const b = spawnPlayer(w, { x: 3, y: 3 });
    w.predicted.add(a); w.predictLead = 5;
    expect(w.simTick(a)).toBe(w.tick + 5); expect(w.simTick(b)).toBe(w.tick);
    w.isReplaying = true; expect(w.simTick(a)).toBe(w.tick); w.isReplaying = false;
  });
  it("predictContactSlow slows a predicted entity on spikes, in the server tick frame", () => {
    const w = makeWorld(); spike(w, 5, 5); const v = spawnPlayer(w, { x: 5.5, y: 5.5 });
    w.predicted.add(v);
    let applied = false;
    for (let i = 0; i < 40 && !applied; i++) { predictContactSlow(w, 1 / 30); applied = evaluate(w, v, Buffs, Stat.MoveSpeed, 1, w.simTick(v)) < 1; w.predictLead = i + 1; }
    expect(applied).toBe(true);
    const far = spawnPlayer(w, { x: 30, y: 30 }); w.predicted.add(far);
    for (let i = 0; i < 40; i++) { w.predictLead = i; predictContactSlow(w, 1 / 30); }
    expect(evaluate(w, far, Buffs, Stat.MoveSpeed, 1, w.simTick(far))).toBe(1);
  });
});
