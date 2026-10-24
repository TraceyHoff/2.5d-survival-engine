import { describe, it, expect } from "vitest";
import { Appearance, World, getAppearance, setAppearance, slotIndex, type CosmeticCatalogLike, type WearableDef, type AppearanceValue } from "@engine/core";
import { LayerCache, coreAppearanceBinding, facingBucket, toCachedLayers, LAYER_BIAS, HELD_BIAS } from "../src/index.js";

const w = (id: number, key: string, slot: WearableDef["slot"], layer: number, extra: Partial<WearableDef> = {}): WearableDef =>
  ({ id, key, slot, layer, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags: [], bodies: { male: { sprite: 100 + id, anim: "idle", hatHair: { sprite: 200 + id, anim: "idle" } } }, ...extra });
const parts = [w(1, "hair", "hair", 40), w(2, "cap", "hat", 50, { hatHair: true }), w(3, "top", "top", 20), w(4, "shoes", "shoes", 15),
  w(5, "pack", "accessory", 30, { layerByDir: [30, 30, 30, 5] })];
const cat: CosmeticCatalogLike = {
  wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }),
  skinTones: [{ index: 0, key: "s", color: 0xffccaa }], hairColors: [{ index: 0, key: "h", color: 0x332211 }], clothingColors: [{ index: 0, key: "c", color: 0x2244aa }],
};
const app = (ids: Partial<Record<WearableDef["slot"], number>>): AppearanceValue => {
  const p = new Array(8).fill(0); for (const [s, id] of Object.entries(ids)) p[slotIndex(s as WearableDef["slot"])] = id;
  return { bodyType: 0, skinTone: 0, parts: p, primary: new Array(8).fill(0), secondary: new Array(8).fill(0) };
};
const binding = coreAppearanceBinding(cat);
const slots = (a: AppearanceValue, f: number): string[] => toCachedLayers(binding.resolve(a, f), binding).map((l) => l.slot);

describe("character layer ordering", () => {
  it("draws body first then wearables by layer", () => {
    expect(slots(app({ hair: 1, top: 3, shoes: 4 }), Math.PI / 2)).toEqual(["body", "shoes", "top", "hair"]);
  });
  it("hat swaps hair to its hatHair art and sits on top", () => {
    const l = toCachedLayers(binding.resolve(app({ hair: 1, hat: 2 }), 0), binding);
    expect(l.map((x) => x.slot)).toEqual(["body", "hair", "hat"]);
    expect(l[1]!.sprite).toBe(201);
  });
  it("layerByDir moves the backpack behind the body when facing away", () => {
    const a = app({ accessory: 5, top: 3 });
    expect(slots(a, 0)).toEqual(["body", "top", "accessory"]);
    expect(slots(a, -Math.PI / 2)[0]).toBe("accessory");
  });
  it("layer depth biases stay contiguous and below the held-item bias", () => {
    expect(10 * LAYER_BIAS).toBeLessThan(HELD_BIAS);
  });
  it("tints come from the palettes (RGBA8)", () => {
    const l = toCachedLayers(binding.resolve(app({ top: 3 }), 0), binding);
    expect(l[0]!.tint).toBe(((0xffccaa << 8) | 255) >>> 0);
    expect(l[1]!.tint).toBe(((0x2244aa << 8) | 255) >>> 0);
  });
});

describe("LayerCache invalidation", () => {
  const setup = () => {
    const world = new World({ seed: 1 }); world.register(Appearance);
    const e = world.create(); setAppearance(world, e, app({ hair: 1 }));
    const c = new LayerCache(binding);
    const get = (ent = e, f = 0) => { const a = getAppearance(world, ent)!; return c.get(ent & 0xfffff, ent, a.version, f, () => a); };
    return { world, e, c, get };
  };
  it("hits while version and facing4 are unchanged", () => {
    const { c, get } = setup(); const a = get(); expect(get()).toBe(a); expect(get(undefined, 0.3)).toBe(a); expect(c.resolves).toBe(1);
  });
  it("misses on a facing bucket change", () => {
    const { c, get } = setup(); get(); expect(facingBucket(Math.PI)).not.toBe(facingBucket(0)); get(undefined, Math.PI); expect(c.resolves).toBe(2);
  });
  it("misses on setAppearance (version bump)", () => {
    const { world, e, c, get } = setup(); get(); setAppearance(world, e, app({ hair: 1, top: 3 }));
    expect(get().map((l) => l.slot)).toContain("top"); expect(c.resolves).toBe(2);
  });
  it("misses across the u16 version wrap (equality only)", () => {
    const { world, e, c } = setup();
    world.set(e, Appearance, { version: 0xffff });
    const read = () => getAppearance(world, e)!;
    c.get(0, e, read().version, 0, read);
    expect(setAppearance(world, e, app({ top: 3 }))).toBe(0);
    const l = c.get(0, e, read().version, 0, read);
    expect(c.resolves).toBe(2); expect(l.map((x) => x.slot)).toEqual(["body", "top"]);
  });
  it("misses when a different entity reuses the index", () => {
    const c = new LayerCache(binding); const a = app({}); c.get(0, 1, 5, 0, () => a); c.get(0, 2, 5, 0, () => a); expect(c.resolves).toBe(2);
  });
});

describe("core DrawLayer render hints (c734b72)", () => {
  it("tintMode/strength/saturation/minor/outline pass through toCachedLayers", () => {
    const [l] = toCachedLayers([{ slot: "hat", sprite: 1, anim: "idle", tintR: 0xff0000, tintMode: "lerp", tintStrength: 0.5, tintSaturation: 1.5, minor: true, outline: false }], {});
    expect(l).toMatchObject({ mode: 3, strength: 0.5, saturation: 1.5, minor: true, outline: false });
    expect(toCachedLayers([{ slot: "torso", sprite: 1, anim: "idle" }], {})[0]!.outline).toBe(true);
  });
});

import { layerTintRef } from "../src/character/layers.js";
import { DEFAULT_TINT_NEUTRAL, directionIndex8, resolveLayers } from "@engine/core";
describe("ADR-082 layer tint contract", () => {
  const N = DEFAULT_TINT_NEUTRAL;
  it("multiply: neutral grey (tintNeutral) at full strength becomes exactly the colour", () => {
    expect(N).toBe(0.78);
    const c: [number, number, number] = [0.6, 0.3, 0.15];
    layerTintRef([N, N, N], c, 0, 1).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
    const n2 = 0.5; layerTintRef([n2, n2, n2], c, 0, 1, 1, 1, n2).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
  });
  it("multiply: strength*mask mixes the factor (half strength = base * (1 + (c/N - 1)/2)); no pre-saturation", () => {
    const r = layerTintRef([N, N, N], [0.39, 0.39, 0.39], 0, 0.5); expect(r[0]).toBeCloseTo(N * (1 + (0.5 - 1) * 0.5), 6);
    expect(layerTintRef([0.5, 0.2, 0.1], [0.3, 0.6, 0.9], 0, 1, 0)).toEqual([0.5, 0.2, 0.1]);
    // saturated base keeps its ratios (no luma pull before tinting)
    const b: [number, number, number] = [0.8, 0.4, 0.2]; const w = layerTintRef(b, [N, N, N], 0, 1); w.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
  });
  it("lerp uses tintNeutral too: a neutral-luma pixel becomes the colour", () => {
    layerTintRef([N, N, N], [0.2, 0.5, 0.7], 3, 1).forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.5, 0.7][i]!, 6));
  });
  it("toCachedLayers carries tintNeutral (default 0.78), layerName, outlineMode; facing buckets are directionIndex8", () => {
    const [a, b, c] = toCachedLayers([{ slot: "top", sprite: 1, anim: "idle", tintNeutral: 0.6, layerName: "sleeves", outlineMode: "none", outline: true },
      { slot: "top", sprite: 2, anim: "idle", outlineMode: "body", outline: false }, { slot: "hat", sprite: 3, anim: "idle", outline: false }], {});
    expect([a!.neutral, a!.layerName, a!.outline]).toEqual([0.6, "sleeves", false]);
    expect([b!.neutral, b!.layerName, b!.outline]).toEqual([0.78, "", true]);
    expect(c!.outline).toBe(false);
    for (let k = 0; k < 16; k++) { const f = (k / 16) * Math.PI * 2; expect(facingBucket(f)).toBe(directionIndex8(f)); }
  });
  it("multi-layer wearable -> one cached layer per layerName; LayerCache keys anim/expression and passes them to resolveLayers", () => {
    const coat = w(9, "coat", "top", 20, { layers: [
      { name: "back", layer: 5, z: 0, tintChannels: 1, bodies: { male: { sprite: 7, anim: "idle" } } },
      { name: "front", layer: 25, z: 0, tintChannels: 0, outlineMode: "none", bodies: { male: { sprite: 8, anim: "idle" } } }] } as Partial<WearableDef>);
    const cat2: CosmeticCatalogLike = { ...cat, wearable: (id) => (id === 9 ? coat : parts.find((p) => p.id === id)) };
    const a = app({ top: 9 }); const raw = resolveLayers(cat2, a, 0);
    const top = toCachedLayers(raw, {}).filter((l) => l.slot === "top");
    expect(top.map((l) => [l.layerName, l.sprite, l.outline])).toEqual([["back", 7, true], ["front", 8, false]]);
    const seen: unknown[] = []; const cache = new LayerCache({ def: Appearance as never, resolve: (_a, _f, o) => { seen.push(o); return raw; } });
    cache.get(0, 1, 1, 0, () => a, { anim: "idle" }); cache.get(0, 1, 1, 0, () => a, { anim: "idle" });
    cache.get(0, 1, 1, 0, () => a, { anim: "hurt" }); cache.get(0, 1, 1, 0, () => a, { anim: "hurt", expression: "smile" });
    expect(cache.resolves).toBe(3); expect(seen[2]).toEqual({ anim: "hurt", expression: "smile" });
  });
});

describe("paperDollDepth (53806f7 lift)", () => {
  // the sprite VS depth for a non-footprint sprite: key + 0.02 + max(hp + footDy, 0) * zPerPx
  const vs = (key: number, footDy: number, hp: number, z: number) => key + 0.02 + Math.max(hp + footDy, 0) * z;
  it("keeps the pivot / above-pivot depth of the unlifted sprite and stays linear (no clamp) below the pivot", async () => {
    const { paperDollDepth } = await import("../src/sprites.js");
    const z = (1 / 3) / 16, key = 7.25; const d = paperDollDepth(key, 60, 54, 1.5, z);
    expect(d.footDy).toBeCloseTo((6 + 24) * 1.5);
    for (const hp of [0, 1, 30, 90]) expect(vs(d.key, d.footDy, hp, z)).toBeCloseTo(vs(key, 0, hp, z), 9);
    // below the pivot (down to the lifted extent) the slope continues: two quads with different extents share one plane
    const slope = (a: number, b: number) => (vs(d.key, d.footDy, a, z) - vs(d.key, d.footDy, b, z)) / (a - b);
    expect(slope(-9, 40)).toBeCloseTo(z, 9); expect(slope(-30, 10)).toBeCloseTo(z, 9);
    // the uncompensated lift (53806f7 as pushed) moved the whole character forward by footDy x zPerPx (~0.9 tile here)
    expect(vs(key, d.footDy, 0, z) - vs(key, 0, 0, z)).toBeGreaterThan(0.5);
  });
});
