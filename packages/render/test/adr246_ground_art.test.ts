import { describe, expect, it } from "vitest";
import { GROUND_PRIORITY, GroundArt, blobReduce, groundHash, groundLayers, groundMaterial, SEASON_ALIASES, SEASON_GROUND, SeasonArt, seasonSpritePixels,
  seasonVisualOf, TileId, VfxLayer, WEATHER_FX, WeatherFx, WeatherKindId, weatherFxLevels } from "../src/index.js";
import { seasonFromDays } from "@engine/core";
import { gtSnow } from "../src/terrainTiles.js";

const grid = (rows: string[]) => { const m: Record<string, number> = { "~": 1, s: 2, g: 3, d: 4, r: 5, n: 6, f: 7, w: 8, m: 9, ".": 0 };
  return (x: number, y: number): number => m[rows[y]?.[x] ?? "."] ?? 0; };

describe("ADR-246 gt_ ground art", () => {
  it("materials, hash and blob-47 reduce", () => {
    expect(groundMaterial(TileId.Mud)).toBe("mud"); expect(groundMaterial(TileId.ShallowWater)).toBe("water"); expect(groundMaterial(0)).toBeUndefined();
    expect(GROUND_PRIORITY.join("<")).toBe("rock<sand<dirt<mud<forest<grass<snow");
    expect(groundHash(3, 7)).toBe(((Math.imul(3, 374761393) ^ Math.imul(7, 668265263)) >>> 0) % 997);
    let n = 0; for (let k = 0; k < 256; k++) if (blobReduce(k) === k) n++; expect(n).toBe(47);
    expect(blobReduce(1 | 16)).toBe(1); expect(blobReduce(16)).toBe(16);
  });
  it("layers: base variant + season suffix, higher-priority edges only, shore on sand / bank elsewhere", () => {
    const t = grid(["sgg", "sdg", "~~~"]); const L = groundLayers(t, 1, 1, 1);
    const v = ["", "_b", "_c", "_d", "_e", "_f"][groundHash(1, 1) % 6];
    expect(L[0]).toEqual({ key: `gt_dirt${v}_fall`, kind: 0 });
    expect(L.map((l) => l.key)).toContain("gt_grass_edge_3_fall"); // N + E (NE reduced away)
    expect(L.some((l) => l.key.startsWith("gt_sand_edge"))).toBe(false); // sand is below dirt
    expect(L.at(-1)!.key).toBe("gt_bank_4_fall");
    expect(groundLayers(t, 0, 1, 0).at(-1)!.key).toBe("gt_shore_4");
  });
  it("water: animated + tinted in summer, fall leaves on top, winter = static ice (no water layer)", () => {
    const t = grid(["~~~~", "~~~~"]); expect(groundLayers(t, 1, 1, 0)).toEqual([{ key: "gt_water", kind: 3 }]);
    expect(groundLayers(grid(["w"]), 0, 0, 0)[0]!.key).toBe("gt_water_shallow");
    const ice = groundLayers(t, 1, 1, 2); expect(ice).toHaveLength(1); expect(ice[0]!.kind).toBe(4); expect(ice[0]!.key).toMatch(/^gt_ice(_[b-f])?$/);
    let leaves = 0; for (let x = 0; x < 400; x++) { const l = groundLayers(() => 1, x, 0, 1, () => 1); if (l.length === 2) { leaves++; expect(l[1]!.key).toMatch(/^gt_water_leaves_[abc]$/); expect(l[1]!.kind).toBe(5); } }
    expect(leaves).toBeGreaterThan(60); expect(leaves).toBeLessThan(180);
  });
  it("GroundArt loader: exact, season fallback, winter ice -> gt_water_winter, pages per season", () => {
    const keys = ["gt_grass", "gt_water", "gt_water_winter", "gt_grass_fall", "gt_water_leaves_a"]; const atl = ["p0", "p0", "w0", "f0", "p0"];
    const reg = { ids: { sprites: { tryId: (k: string) => { const i = keys.indexOf(k); return i < 0 ? undefined : i; } } }, sprite: (id: number) => ({ key: keys[id]!, atlas: { key: atl[id]! } }) };
    const g = new GroundArt(reg); expect(g.available).toBe(true);
    expect(g.id("gt_grass_fall")).toBe(3); expect(g.id("gt_grass_winter")).toBe(0); expect(g.id("gt_ice_c")).toBe(2); expect(g.id("gt_mud")).toBe(-1);
    expect(g.pageSprites(2).map((i) => atl[i])).toContain("w0"); expect(g.pageSprites(1).map((i) => atl[i])).toContain("f0");
    expect(new GroundArt({ ...reg, ids: { sprites: { tryId: () => undefined } } }).available).toBe(false);
  });
  it("procedural snow on gt land: winter art keeps only 35% weather snow; other seasons keep the floor", () => {
    expect(gtSnow(3, 0.8, 0.9)).toBeCloseTo(0.28); expect(gtSnow(2, 0.1, 0.4)).toBe(0.4); expect(gtSnow(1, 0.5, 0)).toBe(0.5);
  });
});

describe("ADR-246 seasonal roads + tree_autumn", () => {
  const px = (): Uint8ClampedArray => { const p = new Uint8ClampedArray(16 * 16 * 4); for (let i = 0; i < 256; i++) p.set([120, 100, 80, 255], i * 4); return p; };
  const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) n++; return n; };
  it("ground pass: identity in summer, leaf speckle in fall, snow dusting in winter", () => {
    const s = px(); seasonSpritePixels(s, 16, 16, SEASON_GROUND, 0.03, 0, 0, 0); expect(diff(s, px())).toBe(0);
    const f = px(); seasonSpritePixels(f, 16, 16, SEASON_GROUND, 0.03, 1, 0, 0); const nf = diff(f, px()); expect(nf).toBeGreaterThan(8); expect(nf).toBeLessThan(256);
    const w = px(); seasonSpritePixels(w, 16, 16, SEASON_GROUND, 0.03, 0, 1, 1); let white = 0; for (let i = 0; i < w.length; i += 4) if (w[i]! > 200) white++;
    expect(white).toBeGreaterThan(30); expect(white).toBeLessThan(256);
  });
  it("tree_autumn keeps its art in fall and borrows tree_winter in winter", () => {
    expect(SEASON_ALIASES.tree_autumn![2]).toBe("tree_winter");
    const keys = ["tree_autumn", "tree_winter"]; const reg = { ids: { sprites: { tryId: (k: string) => { const i = keys.indexOf(k); return i < 0 ? undefined : i; } } }, sprite: (id: number) => ({ key: keys[id]! }) };
    const art = new SeasonArt(reg); expect(art.resolve(0, seasonVisualOf(seasonFromDays(25, 10, 2))).sid).toBe(1);
    expect(art.resolve(0, seasonVisualOf(seasonFromDays(15, 10, 2))).sid).toBe(0);
  });
});

describe("ADR-246 weather fx sprites", () => {
  const view = { x0: 0, y0: 0, x1: 20, y1: 20, tiles: 400 };
  it("levels from the ADR-239 weather", () => {
    expect(weatherFxLevels(WeatherKindId.Snow, { snow: 0.6, wind: 0 }, 1)).toEqual({ snow: 0.6, blizzard: 0, haze: 0 });
    expect(weatherFxLevels(WeatherKindId.Blizzard, { snow: 0.1, wind: 1 }, 1).blizzard).toBe(0.35);
    expect(weatherFxLevels(WeatherKindId.Heat, { snow: 0, wind: 0 }, 0.95).haze).toBe(1); expect(weatherFxLevels(WeatherKindId.Heat, { snow: 0, wind: 0 }, 0.2).haze).toBe(0);
  });
  it("spawns up to the cap, scaled by quality, nothing in clear weather or without the sprite", () => {
    const ids: Record<string, number> = { fx_snowflake: 1, fx_blizzard: 2, fx_heat_haze: 3 }; let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const v = new VfxLayer(), f = new WeatherFx();
    for (let i = 0; i < 300; i++) f.update(v, (k) => ids[k], WeatherKindId.Blizzard, { snow: 1, wind: 1 }, 1, { x: 1, y: 0 }, view, 0.1, rnd);
    const c = f.counts(); expect(c.snow).toBeGreaterThan(0); expect(c.snow).toBeLessThanOrEqual(WEATHER_FX.snow.cap); expect(c.blizzard).toBeLessThanOrEqual(WEATHER_FX.blizzard.cap); expect(c.haze).toBe(0);
    const g = new WeatherFx(); g.scale = 0.5; for (let i = 0; i < 300; i++) g.update(v, (k) => ids[k], WeatherKindId.Snow, { snow: 1, wind: 0 }, 1, { x: 0, y: 0 }, view, 0.1, rnd);
    expect(g.counts().snow).toBeLessThanOrEqual(45);
    const h = new WeatherFx(); for (let i = 0; i < 50; i++) h.update(v, () => undefined, WeatherKindId.Snow, { snow: 1, wind: 0 }, 1, { x: 0, y: 0 }, view, 0.1, rnd); expect(h.counts().snow).toBe(0);
    const k = new WeatherFx(); for (let i = 0; i < 50; i++) k.update(v, (x) => ids[x], WeatherKindId.Clear, { snow: 0, wind: 0 }, 1, { x: 0, y: 0 }, view, 0.1, rnd); expect(k.counts()).toEqual({ snow: 0, blizzard: 0, haze: 0 });
  });
});
