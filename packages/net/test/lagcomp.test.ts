import { describe, expect, it } from "vitest";
import { Transform } from "@engine/core";
import { PositionHistory, rangeCheckWithSlack } from "../src/index.js";
import { DT, makeWorld } from "./fixture.js";

describe("lag compensation helpers", () => {
  it("getPositionAt returns historical (and interpolated) positions within the window", () => {
    const w = makeWorld(); const h = new PositionHistory(w, 20);
    w.addSystem("network", "rec", () => h.record());
    const e = w.create(); w.add(e, Transform, { x: 0 });
    const still = w.create(); w.add(still, Transform, { x: 9 });
    for (let i = 0; i < 30; i++) { w.step(DT); w.setField(e, Transform, "x", i + 1); }
    // tick t recorded x = t (value written after step t-1, captured in step t)
    expect(h.getPositionAt(e, 25)!.x).toBe(25);
    expect(h.getPositionAt(e, 24.5)!.x).toBeCloseTo(24.5);
    expect(h.getPositionAt(still, 15)!.x).toBe(9); // unchanged since tick 0, still inside window
    expect(h.getPositionAt(e, 5)).toBeUndefined(); // outside 1 s window
    expect(h.getPositionAt(e, w.tick + 1)).toBeUndefined();
    w.destroy(e); expect(h.getPositionAt(e, 25)).toBeUndefined();
  });
  it("rangeCheckWithSlack adds fixed slack plus prediction lead", () => {
    expect(rangeCheckWithSlack({ x: 0, y: 0 }, { x: 1.7, y: 0 }, 1.5)).toBe(true);
    expect(rangeCheckWithSlack({ x: 0, y: 0 }, { x: 1.8, y: 0 }, 1.5)).toBe(false);
    expect(rangeCheckWithSlack({ x: 0, y: 0 }, { x: 2.5, y: 0 }, 1.5, { maxSpeed: 4, leadTicks: 4 })).toBe(true);
  });
});
