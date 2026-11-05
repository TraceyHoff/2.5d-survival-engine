// Task 26: black pixels shifting over characters — the hair tintmask's secondary (G) regions are the
// hair's highlight streaks + hairline band, sitting over the forehead/face. A black hair secondary
// (palette index 0 — also the default every look carried) turned those regions near-black: black bars
// across the face that move with facing/anim phase. The tint math is correct and pinned (ADR-082);
// the defect was that nothing ever gave hair a sensible secondary. The fix: the secondary follows
// the primary by default, and a stored black secondary is repaired to the primary at validation.
import { describe, it, expect } from "vitest";
import { defaultAppearance, resolveLayers, slotIndex, validateAppearance, type CosmeticCatalogLike, type WearableDef } from "../src/index.js";

const wd = (id: number, slot: WearableDef["slot"]): WearableDef => ({
  id, key: `w${id}`, slot, bodies: { male: { sprite: id, anim: "idle" }, female: { sprite: id, anim: "idle" } },
  layer: 40, z: 0, tintChannels: 2, hidesSlots: [], hatHair: false, unlockTags: [],
}) as unknown as WearableDef;
const W = new Map([[1, wd(1, "hair")], [2, wd(2, "face")], [3, wd(3, "top")]]);
const hairPal = ["black", "espresso", "chestnut", "auburn", "ginger", "strawberry"].map((key, index) => ({ index, key, color: index === 0 ? 0x2e2630 : index === 5 ? 0xe09a6a : 0x7a4a2c }));
const clothPal = ["white", "cream", "charcoal"].map((key, index) => ({ index, key, color: index === 0 ? 0xf4f0e8 : 0x4a4250 }));
const cat: CosmeticCatalogLike = { wearable: (i) => W.get(i), bodySprite: () => ({ sprite: 0, anim: "idle" }), skinTones: [{ index: 0, key: "porcelain", color: 0xfaf5d5 }], hairColors: hairPal, clothingColors: clothPal };

describe("Task 26: hair/face black secondary (black bars across the face)", () => {
  it("defaultAppearance starts uniform: secondary == primary for every slot", () => {
    const a = defaultAppearance(cat);
    expect(a.secondary).toEqual(a.primary);
  });
  it("validateAppearance (clamp) repairs a black hair secondary to the primary and records it", () => {
    const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = 1; a.primary[slotIndex("hair")] = 5; a.secondary[slotIndex("hair")] = 0; // strawberry + black (the reported look)
    const r = validateAppearance(cat, a);
    expect(r.value!.secondary[slotIndex("hair")]).toBe(5);
    expect(r.issues.some((i) => i.includes("hair") && i.includes("black secondary"))).toBe(true);
  });
  it("validateAppearance (reject) normalises silently so the submission is accepted, not blocked", () => {
    const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = 1; a.primary[slotIndex("hair")] = 5; a.secondary[slotIndex("hair")] = 0;
    const r = validateAppearance(cat, a, { mode: "reject" });
    expect(r.value).toBeDefined(); expect(r.issues).toEqual([]);
    expect(r.value!.secondary[slotIndex("hair")]).toBe(5);
  });
  it("uniform black hair (primary black, secondary black) is untouched", () => {
    const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = 1; a.primary[slotIndex("hair")] = 0; a.secondary[slotIndex("hair")] = 0;
    const r = validateAppearance(cat, a);
    expect(r.issues).toEqual([]); expect(r.value!.secondary[slotIndex("hair")]).toBe(0);
  });
  it("a non-black two-tone secondary is preserved (deliberate two-tone still works)", () => {
    const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = 1; a.primary[slotIndex("hair")] = 5; a.secondary[slotIndex("hair")] = 2;
    const r = validateAppearance(cat, a);
    expect(r.issues).toEqual([]); expect(r.value!.secondary[slotIndex("hair")]).toBe(2);
  });
  it("the face slot is repaired the same way; clothing slots are untouched", () => {
    const a = defaultAppearance(cat); a.parts[slotIndex("face")] = 2; a.primary[slotIndex("face")] = 5; a.secondary[slotIndex("face")] = 0;
    a.parts[slotIndex("top")] = 3; a.primary[slotIndex("top")] = 1; a.secondary[slotIndex("top")] = 0;
    const r = validateAppearance(cat, a);
    expect(r.value!.secondary[slotIndex("face")]).toBe(5);
    expect(r.value!.secondary[slotIndex("top")]).toBe(0); // clothing palette index 0 is white, not black
  });
  it("no 'black' key in the palette -> no repair (robust to palette reordering)", () => {
    const noBlack: CosmeticCatalogLike = { ...cat, hairColors: hairPal.slice(1).map((c, i) => ({ ...c, index: i })) };
    const a = defaultAppearance(noBlack); a.parts[slotIndex("hair")] = 1; a.primary[slotIndex("hair")] = 4; a.secondary[slotIndex("hair")] = 0;
    const r = validateAppearance(noBlack, a);
    expect(r.issues).toEqual([]); expect(r.value!.secondary[slotIndex("hair")]).toBe(0);
  });
  it("the repaired look resolves with no black tint on the hair layer (the reported artifact is gone)", () => {
    const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = 1; a.primary[slotIndex("hair")] = 5; a.secondary[slotIndex("hair")] = 0;
    const repaired = validateAppearance(cat, a).value!;
    const layers = resolveLayers(cat, repaired, 1); // facing 1 = front, as in the screenshot
    const hair = layers.find((l) => l.slot === "hair")!;
    expect(hair.tintR).toBe(0xe09a6a); expect(hair.tintG).toBe(0xe09a6a); // uniform strawberry, no black
    expect(hair.tintG).not.toBe(0x2e2630);
  });
});
