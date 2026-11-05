// Task 26: black bars across the face — the creator must never produce a black hair secondary by
// default. The secondary follows the primary until the player deliberately diverges it via the
// :color2 row; random looks roll uniform hair/face. Pinned against the real pack palettes.
import { describe, expect, it } from "vitest";
import { defaultAppearance, resolveLayers, slotIndex, validateAppearance, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { randomLook, stepLook } from "../src/character-creator.js";
import { readManifestJson } from "@engine/assets/read-manifest";

const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 40, z: 0, tintChannels: 2 }) as unknown as WearableDef;
const parts = [W(82, "hair_spiky", "hair"), W(49, "eyes_round", "eyes")];
const manifest = readManifestJson("packages/assets/pack/customization/manifest.customization.json") as Record<string, { key: string; color: string }[]>;
const pal = (k: string) => manifest[k]!.map((c, index) => ({ index, key: c.key, color: parseInt(c.color.slice(1), 16) }));
const cat: CosmeticCatalogLike = { wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: pal("skinTones"), hairColors: pal("hairColors"), clothingColors: pal("clothingColors"), defaults: { eyes: 49 } };
const strawberry = cat.hairColors.findIndex((c) => c.key === "strawberry");
const black = cat.hairColors.findIndex((c) => c.key === "black");

describe("Task 26: creator never defaults hair to a black secondary", () => {
  it("stepping hair:color syncs the hair secondary to the new primary; the face is untouched (Task 25)", () => {
    let v = randomLook(cat, () => 0.3);
    const face0 = v.primary[slotIndex("face")]!;
    v = stepLook(cat, v, "hair:color", 1);
    expect(v.secondary[slotIndex("hair")]).toBe(v.primary[slotIndex("hair")]);
    expect(v.primary[slotIndex("face")]).toBe(face0);
  });
  it("the :color2 row can still diverge the secondary afterwards (deliberate two-tone)", () => {
    let v = randomLook(cat, () => 0.3);
    v = stepLook(cat, v, "hair:color2", 1);
    expect(v.secondary[slotIndex("hair")]).not.toBe(v.primary[slotIndex("hair")]);
  });
  it("randomLook rolls uniform hair/face (secondary == primary)", () => {
    for (const seed of [0.1, 0.3, 0.7, 0.99]) {
      const v = randomLook(cat, () => seed);
      expect(v.secondary[slotIndex("hair")]).toBe(v.primary[slotIndex("hair")]);
      expect(v.secondary[slotIndex("face")]).toBe(v.primary[slotIndex("face")]);
    }
  });
  it("the reported screenshot look (spiky + strawberry + black secondary) repairs to uniform strawberry", () => {
    expect(strawberry).toBeGreaterThan(0); expect(black).toBe(0);
    const look = defaultAppearance(cat);
    look.parts[slotIndex("hair")] = 82; look.primary[slotIndex("hair")] = strawberry; look.secondary[slotIndex("hair")] = black;
    const repaired = validateAppearance(cat, look).value!;
    expect(repaired.secondary[slotIndex("hair")]).toBe(strawberry);
    const layers = resolveLayers(cat, repaired, 1); // facing 1 = front, as in the screenshot
    const hair = layers.find((l) => l.slot === "hair")!;
    expect(hair.tintR).toBe(cat.hairColors[strawberry]!.color);
    expect(hair.tintG).toBe(cat.hairColors[strawberry]!.color);
    expect(hair.tintG).not.toBe(cat.hairColors[black]!.color);
  });
});
