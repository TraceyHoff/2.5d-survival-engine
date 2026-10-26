import { describe, expect, it } from "vitest";
import { TileMap, waterShoreTint, waterCornerTint, bilerpTint } from "@engine/world";
import { waterRgb } from "../src/canvas2d.js";

function lake(): TileMap {
  const m = new TileMap(); const c = m.ensureChunk(0, 0);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) c.tiles[y * 32 + x] = x >= 2 && x < 30 && y >= 2 && y < 30 ? 1 : 3;
  return m;
}

describe("ADR-184: smooth, stronger shore->deep water tint", () => {
  it("tint is continuous across every tile edge (neighbouring tiles agree on the shared edge)", () => {
    const m = lake(); const t = (x: number, y: number) => m.getTile(x, y); const cT = (x: number, y: number) => waterCornerTint(t, x, y);
    const tile = (x: number, y: number, fx: number, fy: number) => bilerpTint(cT(x, y), cT(x + 1, y), cT(x + 1, y + 1), cT(x, y + 1), fx, fy);
    let maxJump = 0;
    for (let y = 2; y < 29; y++) for (let x = 2; x < 29; x++) for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      expect(tile(x, y, 1, f)).toBeCloseTo(tile(x + 1, y, 0, f), 9); // +x edge
      expect(tile(x, y, f, 1)).toBeCloseTo(tile(x, y + 1, f, 0), 9); // +y edge
      maxJump = Math.max(maxJump, Math.abs(tile(x, y, 0.5, 0.5) - tile(x + 1, y, 0.5, 0.5)));
    }
    expect(maxJump).toBeLessThan(0.25); // gentle slope, not hard steps
  });
  it("spans the full range: shore 1, deep centre 0, with intermediate values", () => {
    const m = lake(); const t = (x: number, y: number) => m.getTile(x, y);
    expect(waterCornerTint(t, 2, 16)).toBe(1); expect(waterShoreTint(t, 16, 16)).toBe(0);
    const vals = new Set([2, 3, 4, 5, 6, 7, 8].map((x) => waterShoreTint(t, x, 16))); expect(vals.size).toBeGreaterThanOrEqual(6);
  });
  it("colours run from light turquoise at the shore to deep blue in the centre", () => {
    const [sr, sg, sb] = waterRgb(1), [dr, dg, db] = waterRgb(0);
    expect(sg).toBeGreaterThan(180); expect(Math.abs(sg - sb)).toBeLessThan(30); // turquoise: G ~ B, bright
    expect(db).toBeGreaterThan(dg * 1.5); expect(dr + dg + db).toBeLessThan((sr + sg + sb) * 0.6); // clearly darker blue
  });
});
