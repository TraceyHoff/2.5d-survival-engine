import { describe, it, expect } from "vitest";
import { worldToScreen, screenToWorld, screenToTile, TileMap, CHUNK_SIZE, tileToChunk, tileToLocal, SpatialHash } from "../src/index.js";

describe("iso coords", () => {
  it("projects 2:1 and inverts", () => {
    expect(worldToScreen(1, 0)).toEqual({ sx: 32, sy: 16 });
    expect(worldToScreen(0, 1)).toEqual({ sx: -32, sy: 16 });
    for (const [x, y, z] of [[3.5, -2.25, 0], [10, 7, 2], [-5, 4, 1]] as const) {
      const s = worldToScreen(x, y, z); const w = screenToWorld(s.sx, s.sy, z);
      expect(w.x).toBeCloseTo(x); expect(w.y).toBeCloseTo(y);
    }
    expect(screenToTile(worldToScreen(4.5, 2.5).sx, worldToScreen(4.5, 2.5).sy)).toEqual({ tx: 4, ty: 2 });
  });
});
describe("chunks", () => {
  it("maps tiles to chunks incl. negatives", () => {
    expect(tileToChunk(-1)).toBe(-1); expect(tileToLocal(-1)).toBe(CHUNK_SIZE - 1); expect(tileToChunk(32)).toBe(1);
    const m = new TileMap(); m.setTile(5, 5, 3); m.setTile(-1, -40, 9); m.setTile(31, 0, 2);
    expect(m.getTile(5, 5)).toBe(3); expect(m.getTile(-1, -40)).toBe(9); expect(m.getTile(100, 100)).toBe(0);
    expect(m.chunkCount).toBe(2);
    const c = m.getChunk(0, 0)!; expect(c.dirty).toBe(true); expect(c.version).toBe(2);
    expect(m.unloadChunk(0, 0)).toBe(true); expect(m.getTile(5, 5)).toBe(0);
  });
});
describe("spatial hash", () => {
  it("inserts, moves, queries, removes", () => {
    const h = new SpatialHash(4); h.insert(1, 0, 0); h.insert(2, 10, 10); h.insert(3, -3, 1);
    expect(h.queryRadius(0, 0, 2).sort()).toEqual([1, 3]);
    h.insert(1, 20, 20); expect(h.queryRadius(0, 0, 2)).toEqual([3]);
    h.remove(3); expect(h.queryRadius(0, 0, 2)).toEqual([]);
    expect(h.queryRadius(20, 20, 1)).toEqual([1]);
  });
});
