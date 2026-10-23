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
