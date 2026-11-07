import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ISO, TileMap } from "@engine/world";
import type { AtlasManager } from "../src/assets/atlasManager.js";
import { TileTerrain } from "../src/terrainTiles.js";

describe("ADR-267 complete destination terrain", () => {
  it("builds every active destination chunk synchronously, retains other quarters, and reuses only fresh meshes", () => {
    const map = new TileMap(); map.setTile(0, 0, 3); map.setTile(32, 0, 3); map.setTile(64, 0, 3);
    const chunks = [...map.loadedChunks()], active = new Set(chunks.slice(0, 2).map((c) => c.key));
    const views = Array.from({ length: 4 }, () => new Map());
    const iso = { ...DEFAULT_ISO, view: 2 };
    let revision = 0;
    const build = vi.fn((_map: TileMap, chunk: unknown, _atlas: AtlasManager, _old: unknown, _art: number, quarter: number) => ({ chunk, quarter, revision }));
    // Test the preparation contract independently of GPU allocation / shader compilation.
    const terrain = Object.assign(Object.create(TileTerrain.prototype) as object, {
      iso, views, groundMode: () => 0, fresh: (_map: unknown, _chunk: unknown, _atlas: unknown, old: { revision: number } | undefined) => old?.revision === revision, build,
    }) as unknown as TileTerrain;
    const atlas = {} as AtlasManager;
    terrain.prepareView(map, atlas, active);
    expect(views[2]!.size).toBe(2); expect(views[0]!.size).toBe(0); expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls.every((c) => c[5] === 2)).toBe(true);
    terrain.prepareView(map, atlas, active); expect(build).toHaveBeenCalledTimes(2);
    revision++; terrain.prepareView(map, atlas, active); expect(build).toHaveBeenCalledTimes(4); // settled atlas invalidates BOTH active chunks
    iso.view = 3; terrain.prepareView(map, atlas, active);
    expect(views[2]!.size).toBe(2); expect(views[3]!.size).toBe(2); expect(build).toHaveBeenCalledTimes(6);
    expect(views[3]!.has(chunks[0])).toBe(true); expect(views[3]!.has(chunks[2])).toBe(false); // unloaded/off-interest work is not fabricated
  });
});
