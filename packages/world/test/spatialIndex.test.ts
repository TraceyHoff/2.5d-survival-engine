import { describe, it, expect } from "vitest";
import { World, Transform } from "@engine/core";
import { installSpatialIndex, SpatialIndexRes } from "../src/index.js";
describe("shared spatial index", () => {
  it("tracks Transform via postSim system; radius/rect queries; removal", () => {
    const w = new World(); const pre = w.create(); w.add(pre, Transform, { x: 1, y: 1 });
    const idx = installSpatialIndex(w, { cellSize: 4 }); expect(installSpatialIndex(w)).toBe(idx);
    expect(w.resource(SpatialIndexRes)).toBe(idx); expect(w.systemOrder()).toContainEqual({ phase: "postSim", name: "spatialIndex" });
    const a = w.create(); w.add(a, Transform, { x: 10, y: 10 });
    const b = w.create(); w.add(b, Transform, { x: 13, y: 10 });
    w.step(0.05);
    expect(idx.queryRadius(1, 1, 0.5)).toEqual([pre]);
    expect(idx.queryRadius(10, 10, 2)).toEqual([a]);
    expect(new Set(idx.queryRect(9, 9, 14, 11))).toEqual(new Set([a, b]));
    w.setField(a, Transform, "x", 100); w.destroy(b); w.step(0.05);
    expect(idx.queryRect(9, 9, 14, 11)).toEqual([]); expect(idx.queryRadius(100, 10, 1)).toEqual([a]);
  });
});
