import { describe, it, expect } from "vitest";
import { clampToSnapReach, SNAP_REACH_MARGIN } from "../src/index.js";

describe("ADR-142 snap reach margin", () => {
  it("leaves aims inside reach − margin untouched", () => {
    expect(clampToSnapReach({ x: 0, y: 0 }, { x: 2, y: 1 }, 4)).toEqual({ x: 2, y: 1 });
  });
  it("pulls rim/outside aims in so snapping outward stays in reach", () => {
    const r = clampToSnapReach({ x: 10, y: 10 }, { x: 14, y: 10 }, 4);
    expect(r.x).toBeCloseTo(14 - SNAP_REACH_MARGIN); expect(r.y).toBe(10);
    const d = clampToSnapReach({ x: 0, y: 0 }, { x: 30, y: 40 }, 4);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(4 - SNAP_REACH_MARGIN);
  });
});
