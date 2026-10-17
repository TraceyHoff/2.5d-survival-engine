import { describe, expect, it } from "vitest";
import { InterpolationBuffer } from "../src/index.js";

describe("InterpolationBuffer", () => {
  it("lerps between bracketing samples, extrapolates at most 1 tick, holds before first", () => {
    const b = new InterpolationBuffer(32, 1);
    b.push(1, 10, [0]); b.push(1, 12, [2]); b.push(1, 11, [1]);
    expect(b.sample(1, 10.5)![0]).toBeCloseTo(0.5);
    expect(b.sample(1, 11.75)![0]).toBeCloseTo(1.75);
    expect(b.sample(1, 13)![0]).toBeCloseTo(3);
    expect(b.sample(1, 20)![0]).toBeCloseTo(3);
    expect(b.sample(1, 5)![0]).toBe(0);
    expect(b.sample(2, 10)).toBeUndefined();
  });
  it("angular fields take the short way round; capacity bounds memory", () => {
    const b = new InterpolationBuffer(4, 0, [true]);
    b.push(1, 0, [Math.PI - 0.1]); b.push(1, 1, [-Math.PI + 0.1]);
    expect(Math.abs(b.sample(1, 0.5)![0]!)).toBeCloseTo(Math.PI);
    for (let t = 2; t < 10; t++) b.push(1, t, [t]);
    expect(b.sample(1, 0)![0]).toBe(6);
  });
});
