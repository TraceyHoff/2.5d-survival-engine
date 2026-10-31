import { describe, expect, it } from "vitest";
import { World, Season, TimeOfDay, seasonFromDays } from "@engine/core";
import { SEASON_FOLIAGE, SEASON_SNOWCAP, SUMMER_VISUAL, SeasonArt, readSeason, seasonClassOf, seasonGroundRgb, seasonSpritePixels, seasonVisual, seasonVisualOf, setSeasonState,
  SEASON_GROUND_GLSL, SEASON_SPRITE_GLSL, DEFAULT_WEATHER_TABLE, weatherTargets } from "../src/index.js";

const info = (days: number) => seasonFromDays(days, 10, 2);

describe("ADR-239 season visuals", () => {
  it("classifies sprites: deciduous foliage+snow, evergreen/props snow only, items/characters/explicit art untouched", () => {
    expect(seasonClassOf("tree")).toBe(SEASON_FOLIAGE | SEASON_SNOWCAP);
    expect(seasonClassOf("berry_bush")).toBe(SEASON_FOLIAGE | SEASON_SNOWCAP);
    expect(seasonClassOf("tree_pine")).toBe(SEASON_SNOWCAP);
    expect(seasonClassOf("roof_wood")).toBe(SEASON_SNOWCAP);
    expect(seasonClassOf("boulder")).toBe(SEASON_SNOWCAP);
    expect(seasonClassOf("iron_ore")).toBe(SEASON_SNOWCAP);
    for (const k of ["icon_axe", "held_axe", "fx_leaf", "character_base", "tree_oak_fall", "tree_oak_winter", "floor_wood", undefined]) expect(seasonClassOf(k)).toBe(0);
  });
  it("visual weights: summer = no tint; fall full; winter snow + ice; blends are continuous", () => {
    expect(seasonVisualOf(info(5))).toMatchObject({ summer: 1, fall: 0, winter: 0, snow: 0, ice: 0, art: 0 });
    const f = seasonVisualOf(info(15)); expect(f.fall).toBe(1); expect(f.snow).toBe(0); expect(f.art).toBe(1);
    const w = seasonVisualOf(info(25)); expect(w.winter).toBe(1); expect(w.snow).toBeGreaterThan(0.8); expect(w.ice).toBe(1); expect(w.art).toBe(2);
    let prev = seasonVisualOf(info(17)).winter; for (let d = 17; d <= 21; d += 0.05) { const v = seasonVisualOf(info(d)).winter; expect(Math.abs(v - prev)).toBeLessThan(0.05); prev = v; }
    expect(seasonVisualOf(undefined)).toBe(SUMMER_VISUAL);
  });
  it("readSeason: override wins; otherwise the replicated Season at the world tick; summer without Season", () => {
    const w = new World(); expect(seasonVisual(w)).toEqual(SUMMER_VISUAL);
    w.register(TimeOfDay); w.register(Season); w.add(w.environment, TimeOfDay, { dayLengthTicks: 100, epochTick: 0 }); w.add(w.environment, Season, { lengthDays: 10, offsetDays: 20, blendDays: 1 });
    expect(readSeason(w)!.index).toBe(2);
    setSeasonState(w, info(15)); expect(readSeason(w)!.index).toBe(1); setSeasonState(w, undefined); expect(readSeason(w)!.index).toBe(2);
  });
  it("loader prefers <key>_<season> art (fall/autumn, winter) and falls back to procedural flags", () => {
    const keys = ["tree", "tree_fall", "tree_winter", "bush", "bush_autumn", "rock"]; const reg = { ids: { sprites: { tryId: (k: string) => { const i = keys.indexOf(k); return i < 0 ? undefined : i; } } }, sprite: (id: number) => ({ key: keys[id]! }) };
    const art = new SeasonArt(reg);
    const fall = seasonVisualOf(info(15)), win = seasonVisualOf(info(25)), sum = seasonVisualOf(info(5));
    expect(art.resolve(0, fall)).toEqual({ sid: 1, flags: 0 }); expect(art.resolve(0, win)).toEqual({ sid: 2, flags: 0 });
    expect(art.resolve(3, fall)).toEqual({ sid: 4, flags: 0 }); expect(art.resolve(3, win)).toEqual({ sid: 3, flags: SEASON_FOLIAGE | SEASON_SNOWCAP });
    expect(art.resolve(5, win)).toEqual({ sid: 5, flags: SEASON_SNOWCAP }); expect(art.resolve(0, sum)).toEqual({ sid: 0, flags: SEASON_FOLIAGE | SEASON_SNOWCAP });
  });
  it("CPU recolour: green leaves turn warm in fall, bare grey-brown in winter; snow caps whiten top edges; summer is identity", () => {
    const px = (): Uint8ClampedArray => { const p = new Uint8ClampedArray(8 * 8 * 4); for (let i = 0; i < 64; i++) { p.set([60, 140, 50, i >= 16 ? 255 : 0], i * 4); } return p; };
    const s = px(); seasonSpritePixels(s, 8, 8, SEASON_FOLIAGE | SEASON_SNOWCAP, 0.1, 0, 0, 0); expect([...s]).toEqual([...px()]);
    const f = px(); seasonSpritePixels(f, 8, 8, SEASON_FOLIAGE, 0.03, 1, 0, 0); const o = 40 * 4; expect(f[o]!).toBeGreaterThan(f[o + 1]!); // red > green
    const w = px(); seasonSpritePixels(w, 8, 8, SEASON_FOLIAGE, 0.03, 0, 1, 0); expect(w[o + 1]! - Math.max(w[o]!, w[o + 2]!)).toBeLessThan(20); // no longer green
    const sn = px(); seasonSpritePixels(sn, 8, 8, SEASON_SNOWCAP, 0.03, 0, 1, 1); const top = 16 * 4 + 3 * 4; expect(Math.min(sn[top]!, sn[top + 1]!, sn[top + 2]!)).toBeGreaterThan(190);
    const [r, g] = seasonGroundRgb([0.31, 0.54, 0.26], 1, 0, 0.5); expect(r).toBeGreaterThan(g * 0.9);
  });
  it("shared GLSL avoids reserved words and the weather table covers the seasonal kinds", () => {
    for (const src of [SEASON_GROUND_GLSL, SEASON_SPRITE_GLSL]) expect(src).not.toMatch(/\bflat\b\s*[=;,)]/);
    for (const k of [5, 6, 7, 8]) expect(DEFAULT_WEATHER_TABLE[k]).toBeDefined();
    expect(weatherTargets(7, 1).snow).toBe(1); expect(weatherTargets(7, 1).wind).toBe(1); expect(weatherTargets(6, 1).snow).toBe(0); expect(weatherTargets(8, 1).wind).toBeGreaterThan(0.8);
  });
});

describe("ADR-239 sprite shader season block", () => {
  it("declares every helper it calls (sprite fs has no h21/vnoise of its own)", async () => {
    const { SEASON_SPRITE_GLSL: g } = await import("../src/season.js");
    expect(g).toMatch(/float sHash\(vec2 p\)/); expect(g).not.toMatch(/\bh21\(|\bvnoise\(/);
  });
});
