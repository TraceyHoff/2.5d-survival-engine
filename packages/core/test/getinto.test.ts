import { describe, it, expect } from "vitest";
import { World, Transform, defineComponent } from "../src/index.js";

describe("ADR-157 World.getInto", () => {
  it("fills the caller's object with scalar fields, undefined when absent", () => {
    const w = new World(); const e = w.create(); const out = { x: 0, y: 0, z: 0, facing: 0 };
    expect(w.getInto(e, Transform, out)).toBeUndefined();
    w.add(e, Transform, { x: 1.5, y: 2, z: 0.25, facing: 3 });
    const r = w.getInto(e, Transform, out); expect(r).toBe(out); expect(out).toEqual({ x: 1.5, y: 2, z: 0.25, facing: 3 });
    w.destroy(e); expect(w.getInto(e, Transform, out)).toBeUndefined();
  });
  it("skips array fields", () => {
    const C = defineComponent("GetIntoArr", { a: "f32", b: { type: "u8", length: 3 } }); const w = new World(); w.register(C);
    const e = w.create(); w.add(e, C, { a: 2, b: [1, 2, 3] }); const out: Record<string, number> = {};
    expect(w.getInto(e, C, out)).toEqual({ a: 2 });
  });
});
