import { describe, it, expect } from "vitest";
import { blackFrameStep } from "../src/view.js";

describe("ADR-183: Canvas2D renderer (no gl) skips the black-frame check", () => {
  it("does not throw 'reading pending' and creates no check", () => {
    const st = { checks: 0, blackFrames: 0, blackCheck: undefined };
    for (let i = 0; i < 100; i++) expect(() => blackFrameStep(st, { gl: undefined, heldFrames: 0 }, 0, () => 1)).not.toThrow();
    expect(st.blackCheck).toBeUndefined(); expect(st.checks).toBe(0);
  });
});
