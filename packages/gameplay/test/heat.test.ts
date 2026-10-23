import { describe, it, expect } from "vitest";
import { Weather, type World } from "@engine/core";
import { addItem, attachmentsOf, defaultDefs, Fuel, fuelMulOf, placePiece, snapPlacement, spawnPlayer, windsockReading, WINDSOCK_FULL_SPEED } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = defaultDefs();
function place(w: World, key: string) {
  const b = spawnPlayer(w, { x: 0, y: 0 });
  const sn = snapPlacement(w, { piece: d.pieceId(key), x: 3, y: 3, level: 0, rot: 0, tier: 0, variant: 0 });
  if (typeof sn === "number") throw new Error(`snap ${sn}`);
  return placePiece(w, b, sn, { pay: false });
}
describe("heat source pieces", () => {
  it("fireplace / wood_stove burn fuel slower than a campfire", () => {
    const burn = (key: string) => {
      const w = makeWorld(); const fire = attachmentsOf(w, place(w, key)).find((a) => w.has(a, Fuel))!;
      addItem(w, fire, d.itemId("wood"), 2); w.set(fire, Fuel, { lit: 1, burnUntilTick: 0 }); steps(w, 1);
      return { len: w.getField(fire, Fuel, "burnUntilTick")! - w.tick, mul: fuelMulOf(w, fire, d) };
    };
    const c = burn("campfire"), f = burn("fireplace"), s = burn("wood_stove");
    expect([c.mul, f.mul, s.mul]).toEqual([1, 1.5, 2]);
    expect(f.len).toBeGreaterThan(c.len * 1.4); expect(s.len).toBeGreaterThan(c.len * 1.9);
  });
  it("windsock reads core Weather wind", () => {
    const w = makeWorld(); place(w, "windsock");
    expect(d.pieces.get(d.pieceId("windsock"))!.features.windsock).toBe(true);
    Object.assign(w.env(Weather), { windDir: 1.2, windSpeed: 0 }); expect(windsockReading(w).stage).toBe(0);
    Object.assign(w.env(Weather), { windSpeed: WINDSOCK_FULL_SPEED * 2 });
    const r = windsockReading(w); expect(r.stage).toBe(3); expect(r.strength).toBe(1); expect(r.dir).toBeCloseTo(1.2);
  });
});
