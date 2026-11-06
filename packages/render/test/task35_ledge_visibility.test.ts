/**
 * Task 35 / ADR-254: far-side cliff faces and top-face ledge lips stay visible.
 */
import { describe, it, expect } from "vitest";
import { cliffShade, CLIFF_PX, CLIFF_PY, CLIFF_NX, CLIFF_NY, CLIFF_HIDDEN_SHADE, ledgeLipShade, LEDGE_LIP_SHADE } from "../src/tilemap.js";

describe("ADR-254 / Task 35 ledge visibility", () => {
  it("every cliff face has a non-zero shade in every view (far sides are dim, not collapsed)", () => {
    for (let q = 0; q < 4; q++) {
      for (const f of [CLIFF_PX, CLIFF_PY, CLIFF_NX, CLIFF_NY]) {
        expect(cliffShade(f, q)).toBeGreaterThan(0);
      }
      const shades = [CLIFF_PX, CLIFF_PY, CLIFF_NX, CLIFF_NY].map((f) => cliffShade(f, q));
      expect(shades.filter((s) => s === CLIFF_HIDDEN_SHADE).length).toBe(2);
      expect(Math.min(...shades)).toBe(CLIFF_HIDDEN_SHADE);
      expect(Math.max(...shades)).toBeGreaterThanOrEqual(0.62);
    }
  });

  it("ledgeLipShade darkens corners that sit on a height drop", () => {
    expect(ledgeLipShade(false)).toBe(1);
    expect(ledgeLipShade(true)).toBe(LEDGE_LIP_SHADE);
    expect(LEDGE_LIP_SHADE).toBeLessThan(1);
    expect(LEDGE_LIP_SHADE).toBeGreaterThan(0.5);
  });
});
