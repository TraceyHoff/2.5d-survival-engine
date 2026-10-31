import { describe, expect, it } from "vitest";
import { ProceduralGenerator } from "../src/generator.js";

describe("ADR-246 worldgen mud", () => {
  it("places mud only on lowland grass/dirt next to the shore band, deterministically; tileAt == load; opt-out", () => {
    const g = new ProceduralGenerator({ seed: 1234 }); let mud = 0, total = 0;
    for (let cy = -2; cy < 2; cy++) for (let cx = -2; cx < 2; cx++) { const c = g.load(cx, cy).chunk;
      for (let i = 0; i < c.tiles.length; i++) { total++; const tx = cx * 32 + (i % 32), ty = cy * 32 + Math.floor(i / 32); expect(g.tileAt(tx, ty)).toBe(c.tiles[i]); if (c.tiles[i] === 9) mud++; } }
    expect(mud / total).toBeGreaterThan(0.005); expect(mud / total).toBeLessThan(0.08);
    const off = new ProceduralGenerator({ seed: 1234, mud: false }); for (let x = 0; x < 2000; x++) expect(off.tileAt(x, 7)).not.toBe(9);
    expect(new ProceduralGenerator({ seed: 1234 }).load(0, 0).chunk.tiles).toEqual(g.load(0, 0).chunk.tiles);
  });
});
