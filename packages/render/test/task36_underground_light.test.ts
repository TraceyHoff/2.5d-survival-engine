// ADR-263 (Task 36): underground darkness blends the lighting result; negative heights keep ledges.
import { describe, expect, it } from "vitest";
import { computeDayLighting, undergroundInto, UNDERGROUND_DARK } from "../src/timeOfDay.js";
import { tileHeight, NO_TILE_HEIGHT } from "../src/tilemap.js";
import { TileMap, flowWaterRaw } from "@engine/world";

describe("ADR-263 underground lighting", () => {
  it("u = 0 leaves noon untouched; u = 1 is dark with daylight / shadows off and local lights at full glow", () => {
    const a = computeDayLighting(0.5); const before = [...a.ambient]; undergroundInto(a, 0); expect([...a.ambient]).toEqual(before);
    const b = undergroundInto(computeDayLighting(0.5), 1);
    b.ambient.forEach((v, j) => expect(v).toBeCloseTo(UNDERGROUND_DARK[j]!, 9)); expect(b.daylight).toBe(0); expect(b.shadowAlpha).toBe(0); expect(b.glow).toBe(1);
    const c = undergroundInto(computeDayLighting(0.5), 0.5); expect(c.ambient[0]).toBeLessThan(before[0]!); expect(c.ambient[0]).toBeGreaterThan(UNDERGROUND_DARK[0]);
  });
  it("tileHeight reports negative (dug) heights and flowing water levels; missing tiles use NO_TILE_HEIGHT", () => {
    const m = new TileMap(); m.setTile(1, 1, 4); m.ensureChunk(0, 0).setHeight(1, 1, -7);
    m.setTile(2, 1, 1); m.ensureChunk(0, 0).setHeight(2, 1, flowWaterRaw(-7)); m.setTile(3, 1, 1); m.ensureChunk(0, 0).setHeight(3, 1, 6);
    expect(tileHeight(m, 1, 1)).toBe(-7); expect(tileHeight(m, 2, 1)).toBe(-7); expect(tileHeight(m, 3, 1)).toBe(0); // natural water stays flat (ADR-182)
    expect(tileHeight(m, 99, 99)).toBe(NO_TILE_HEIGHT); expect(tileHeight(m, 5, 5)).toBe(NO_TILE_HEIGHT);
  });
});
