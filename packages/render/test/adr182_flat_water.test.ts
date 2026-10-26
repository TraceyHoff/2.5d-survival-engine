import { describe, expect, it } from "vitest";
import { TileMap, waterShoreTint, renderTileHeight, WATER_SURFACE_HEIGHT, waterDepthAt, WaterDepth } from "@engine/world";
import { tileHeight } from "../src/tilemap.js";

/** 12x12 lake (tile 1) in grass (3); the deep centre is stored at height 1, the shallow rim at 0 (as worldgen does). */
function lake(): TileMap {
  const m = new TileMap(); const c = m.ensureChunk(0, 0);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const water = x >= 2 && x < 14 && y >= 2 && y < 14; const i = y * 32 + x;
    c.tiles[i] = water ? 1 : 3; c.height[i] = water ? (x >= 5 && x < 11 && y >= 5 && y < 11 ? 1 : 0) : 1;
  }
  return m;
}

describe("ADR-182: one flat water surface", () => {
  it("shallow and deep water share the same render height regardless of stored height", () => {
    const m = lake(); const t = (x: number, y: number) => m.getTile(x, y);
    expect(waterDepthAt(t, 2, 2)).toBe(WaterDepth.Shallow); expect(waterDepthAt(t, 7, 7)).toBe(WaterDepth.Deep);
    expect(m.getChunk(0, 0)!.height[7 * 32 + 7]).toBe(1); // stored step under the deep centre
    const hs = new Set<number>(); for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) hs.add(tileHeight(m, x, y));
    expect([...hs]).toEqual([WATER_SURFACE_HEIGHT]);
    expect(renderTileHeight(8, 3)).toBe(WATER_SURFACE_HEIGHT); expect(renderTileHeight(3, 2)).toBe(2);
  });
  it("shore tint fades smoothly from the shore to deep water", () => {
    const m = lake(); const t = (x: number, y: number) => m.getTile(x, y);
    const row = [2, 3, 4, 5, 6, 7].map((x) => waterShoreTint(t, x, 7));
    expect(row[0]).toBe(1); for (let i = 1; i < row.length; i++) expect(row[i]!).toBeLessThan(row[i - 1]!);
    expect(row[5]).toBe(0); // ADR-184: 6-tile range expect(waterShoreTint(t, 0, 0)).toBe(0);
  });
});
