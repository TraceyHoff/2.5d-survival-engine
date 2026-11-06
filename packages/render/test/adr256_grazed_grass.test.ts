import { describe, expect, it } from "vitest";
import { GroundArt, groundHash, groundLayers, TileId } from "../src/index.js";

/** ADR-256: GrazedTile cells draw gt_grass_grazed (+ seasonal twin) instead of ungrazed gt_grass. */
describe("ADR-256 grazed grass ground art", () => {
  const grass = (): number => TileId.Grass;
  const grazedAt = (gx: number, gy: number) => (x: number, y: number): boolean => x === gx && y === gy;

  it("ungrazed grass keeps the variant base; grazed swaps to gt_grass_grazed (no _b.._f)", () => {
    const v = ["", "_b", "_c", "_d", "_e", "_f"][groundHash(2, 3) % 6];
    expect(groundLayers(grass, 2, 3, 0)[0]).toEqual({ key: `gt_grass${v}`, kind: 0 });
    expect(groundLayers(grass, 2, 3, 0, undefined, [], undefined, grazedAt(2, 3))[0]).toEqual({ key: "gt_grass_grazed", kind: 0 });
    expect(groundLayers(grass, 2, 3, 0, undefined, [], undefined, grazedAt(9, 9))[0]!.key).toBe(`gt_grass${v}`);
  });

  it("seasonal twins: fall and winter grazed keys", () => {
    expect(groundLayers(grass, 0, 0, 1, undefined, [], undefined, () => true)[0]!.key).toBe("gt_grass_grazed_fall");
    expect(groundLayers(grass, 0, 0, 2, undefined, [], undefined, () => true)[0]!.key).toBe("gt_grass_grazed_winter");
  });

  it("non-grass tiles ignore grazed", () => {
    const dirt = (): number => TileId.Dirt;
    const v = ["", "_b", "_c", "_d", "_e", "_f"][groundHash(1, 1) % 6];
    expect(groundLayers(dirt, 1, 1, 0, undefined, [], undefined, () => true)[0]!.key).toBe(`gt_dirt${v}`);
  });

  it("GroundArt resolves grazed keys and falls back to ungrazed grass when missing", () => {
    const keys = ["gt_grass", "gt_water", "gt_grass_grazed", "gt_grass_grazed_fall", "gt_grass_fall"];
    const atl = ["p0", "p0", "g0", "g0", "f0"];
    const reg = { ids: { sprites: { tryId: (k: string) => { const i = keys.indexOf(k); return i < 0 ? undefined : i; } } }, sprite: (id: number) => ({ key: keys[id]!, atlas: { key: atl[id]! } }) };
    const g = new GroundArt(reg);
    expect(g.id("gt_grass_grazed")).toBe(2);
    expect(g.id("gt_grass_grazed_fall")).toBe(3);
    expect(g.id("gt_grass_grazed_winter")).toBe(2); // strip _winter -> gt_grass_grazed
    expect(g.pageSprites(0).map((i) => atl[i])).toContain("g0");
    // placeholder path when grazed art is absent (manifest placeholders -> gt_grass / gt_grass_fall)
    const bareKeys = ["gt_grass", "gt_water", "gt_grass_fall"];
    const bare = { ids: { sprites: { tryId: (k: string) => { const i = bareKeys.indexOf(k); return i < 0 ? undefined : i; } } }, sprite: (id: number) => ({ key: bareKeys[id]!, atlas: { key: "p0" } }) };
    const b = new GroundArt(bare);
    expect(b.id("gt_grass_grazed")).toBe(0);
    expect(b.id("gt_grass_grazed_fall")).toBe(2); // -> gt_grass_fall
    expect(b.id("gt_grass_grazed_winter")).toBe(0); // -> gt_grass_winter missing -> gt_grass
  });
});
