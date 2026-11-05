import { describe, expect, it } from "vitest";
import { groundLayers, GroundLayerKind, occluderFade, toCachedLayers, coreAppearanceBinding, type CharacterDrawLayer } from "../src/index.js";
import { slotIndex, type CosmeticCatalogLike, type WearableDef, type AppearanceValue } from "@engine/core";

// Tile ids used by the groundLayers grid helper (mirrors adr246_ground_art.test.ts).
const grid = (rows: string[]) => { const m: Record<string, number> = { "~": 1, s: 2, g: 3, d: 4, r: 5, n: 6, f: 7, w: 8, m: 9, ".": 0 };
  return (x: number, y: number): number => m[rows[y]?.[x] ?? "."] ?? 0; };

describe("Task 21: water stops at water tiles (no shore/bank wedge over land)", () => {
  it("sand, grass and dirt next to water emit no shore/bank layer in any season", () => {
    // Centre cell is land with water neighbours (N/S/E/W + corners in the first case).
    const cases: Array<[string[], number, number]> = [
      [["~~~", "~s~", "~~~"], 1, 1], // sand with water all around
      [["ggg", "gsg", "ggg"], 1, 1], // sand island in grass (no water: control, still no shore)
      [["~~~", "~g~", "~~~"], 1, 1], // grass cell with water north/south
      [["~~~", "~d~", "~~~"], 1, 1], // dirt cell with water north/south
    ];
    for (const [rows, x, y] of cases) for (const season of [0, 1, 2]) {
      const keys = groundLayers(grid(rows), x, y, season).map((l) => l.key);
      expect(keys.some((k) => k.includes("shore") || k.includes("bank"))).toBe(false);
    }
    // The old regression grid: sand at (0,1) with water south used to end in gt_shore_4.
    const t = grid(["sgg", "sdg", "~~~"]);
    expect(groundLayers(t, 0, 1, 0).some((l) => l.kind === GroundLayerKind.Shore)).toBe(false);
    expect(groundLayers(t, 0, 1, 0)[0]!.key.startsWith("gt_sand")).toBe(true);
  });
  it("water cells still draw water; edge overlays between land materials still draw", () => {
    const t = grid(["sgg", "sdg", "~~~"]);
    expect(groundLayers(t, 1, 2, 0).map((l) => l.key)).toContain("gt_water");
    expect(groundLayers(t, 1, 1, 1).map((l) => l.key)).toContain("gt_grass_edge_3_fall");
  });
});

describe("Task 21: occluding trees fade to translucent, never invisible", () => {
  it("occluderFade interpolates from opaque to the Occluder fade value", () => {
    expect(occluderFade(0.35, 0)).toBe(1);
    expect(occluderFade(0.35, 1)).toBeCloseTo(0.35);
    expect(occluderFade(0.35, 0.5)).toBeCloseTo(0.675);
    expect(occluderFade(0.45, 1)).toBeCloseTo(0.45); // vehicles (Occluder fade 0.45)
    expect(occluderFade(1, 1)).toBe(1); // never-fade props (campfire) stay opaque
    expect(occluderFade(0.35, 2)).toBeCloseTo(0.35); // clamped
    expect(occluderFade(0.35, -1)).toBe(1); // clamped
  });
  it("the old formula zeroed trees at full occlusion (regression guard)", () => {
    const oldFormula = (fade: number, occT: number, styleAlpha: number): number => 1 - (1 - fade) * occT / Math.max(1e-3, 1 - styleAlpha);
    expect(oldFormula(0.35, 1, 0.35)).toBeCloseTo(0); // the reported bug: tree invisible
    expect(occluderFade(0.35, 1)).toBeGreaterThan(0.3); // the fix: tree stays visible
  });
});

describe("Task 21: per-layer tints stay on their own customization layer (CPU contract)", () => {
  // Same stub pattern as characters.test.ts.
  const w = (id: number, key: string, slot: WearableDef["slot"], layer: number, extra: Partial<WearableDef> = {}): WearableDef =>
    ({ id, key, slot, layer, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags: [], bodies: { male: { sprite: 100 + id, anim: "idle", hatHair: { sprite: 200 + id, anim: "idle" } } }, ...extra });
  const parts = [w(1, "hair", "hair", 40), w(3, "top", "top", 20), w(4, "bottom", "bottom", 15)];
  const cat: CosmeticCatalogLike = {
    wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }),
    skinTones: [{ index: 0, key: "s", color: 0xffccaa }], hairColors: [{ index: 0, key: "h", color: 0x332211 }],
    clothingColors: [{ index: 0, key: "c0", color: 0x2244aa }, { index: 1, key: "c1", color: 0xaa2222 }],
  };
  const binding = coreAppearanceBinding(cat);
  const app = (primary: number[]): AppearanceValue => {
    const p = new Array(8).fill(0); p[slotIndex("hair")] = 1; p[slotIndex("top")] = 3; p[slotIndex("bottom")] = 4;
    return { bodyType: 0, skinTone: 0, parts: p, primary, secondary: new Array(8).fill(0) };
  };
  it("each layer carries its own slot's palette colour", () => {
    const layers = binding.resolve(app(new Array(8).fill(0)), 0);
    const bySlot = Object.fromEntries(layers.map((l) => [l.slot, l]));
    expect(bySlot.body!.tintR).toBe(0xffccaa); // skin
    expect(bySlot.hair!.tintR).toBe(0x332211); // hair palette, not skin or clothing
    expect(bySlot.top!.tintR).toBe(0x2244aa); // clothing palette
  });
  it("changing one slot's primary does not change another layer's cached tint", () => {
    const before = toCachedLayers(binding.resolve(app(new Array(8).fill(0)), 0), binding);
    const prim = new Array(8).fill(0); prim[slotIndex("top")] = 1; // top -> second clothing colour
    const after = toCachedLayers(binding.resolve(app(prim), 0), binding);
    const tintOf = (ls: ReturnType<typeof toCachedLayers>, slot: string): number => ls.find((l) => l.slot === slot)!.tint;
    expect(tintOf(after, "top")).not.toBe(tintOf(before, "top"));
    expect(tintOf(after, "hair")).toBe(tintOf(before, "hair"));
    expect(tintOf(after, "body")).toBe(tintOf(before, "body"));
    expect(tintOf(after, "bottom")).toBe(tintOf(before, "bottom"));
  });
  it("cached layers keep primary and secondary channels separate per layer", () => {
    const layers: CharacterDrawLayer[] = [
      { slot: "top", sprite: 103, anim: "idle", tintR: 0x2244aa, tintG: 0x11cc33 },
      { slot: "bottom", sprite: 104, anim: "idle", tintR: 0xaa2222 },
    ];
    const cached = toCachedLayers(layers, {});
    expect(cached[0]!.tint).toBe(((0x2244aa << 8) | 255) >>> 0);
    expect(cached[0]!.tint2).toBe(((0x11cc33 << 8) | 255) >>> 0);
    expect(cached[1]!.tint).toBe(((0xaa2222 << 8) | 255) >>> 0);
    expect(cached[1]!.tint2).toBe(0); // no secondary on this layer: nothing leaks from the top
  });
});
