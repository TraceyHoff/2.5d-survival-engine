import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLAT_TIE_BREAK, flatDepthKey } from "../src/sprites.js";

const SRC = readFileSync(join(__dirname, "../src/sprites.ts"), "utf8");
const HH = 16;

describe("ADR-195 flat deck seam tie-break", () => {
  it("two same-level neighbouring foundations no longer have equal depth on a shared pixel: the front one wins", () => {
    const keyMin = 3;
    for (const kBack of [10, 57, 240]) {
      const kFront = kBack + 1; // +1 tile in x or y: pivot one hh lower on screen
      for (const hpFront of [-20, -5, 0, 7, 30]) {
        const back = flatDepthKey(kBack, hpFront - HH, HH, keyMin), front = flatDepthKey(kFront, hpFront, HH, keyMin);
        expect(front - back).toBeGreaterThanOrEqual(FLAT_TIE_BREAK * 0.99); // larger key = nearer (keyToNdc)
      }
    }
  });
  it("the bias stays tiny over a screen (no effect on character interleaving)", () => {
    expect(flatDepthKey(203, 0, HH, 3) - (203 + 0.01)).toBeLessThan(0.05);
  });
  it("the vertex shader uses the same tie term for Flat (flags & 8)", () => {
    expect(SRC).toMatch(/\(flags & 8\) != 0 \? aA\.z \+ 0\.01 - hp \/ uHH \+ \(aA\.z - uDepth\.x\) \* \$\{FLAT_TIE_BREAK/);
  });
});
