import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveLayers, slotIndex, type AppearanceValue, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { FACE_VISIBLE_DIRS, liftFaceOverHair } from "../src/character/layers.js";
import { readManifestJson } from "@engine/assets/node";

const man = readManifestJson(fileURLToPath(new URL("../../assets/pack/customization/manifest.customization.json", import.meta.url))) as {
  sprites: { key: string; animations: Record<string, { directions: number; dirFrames?: { rect?: { w: number; h: number } }[] }> }[];
};
const L = (...s: string[]) => s.map((slot) => ({ slot }));

describe("face over hair facings (hair must not cover eyes on a facing that shows the face)", () => {
  it("FACE_VISIBLE_DIRS matches the facings where Art's face/eyes frames have pixels", () => {
    const seen = new Array<boolean>(8).fill(false); let n = 0;
    for (const s of man.sprites) {
      if (!/^cz_(face|eyes)_/.test(s.key)) continue;
      for (const a of Object.values(s.animations)) {
        if (a.directions !== 8 || !a.dirFrames) continue;
        a.dirFrames.forEach((d, i) => { if (d.rect && d.rect.w * d.rect.h > 1) { seen[i % 8] = true; n++; } });
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(seen).toEqual([...FACE_VISIBLE_DIRS]);
  });
  it("lifts face/eyes over hair on both profiles, not on back facings", () => {
    const list = L("body", "face", "eyes", "hair");
    for (const d of [0, 1, 2, 3, 7]) expect(liftFaceOverHair(list, (d * Math.PI) / 4).map((l) => l.slot)).toEqual(["body", "hair", "face", "eyes"]);
    for (const d of [4, 5, 6]) expect(liftFaceOverHair(list, (d * Math.PI) / 4)).toBe(list);
  });
});

/**
 * Task 24 (hair colour "bleeding" onto the face): the full tint pipeline was traced with real pack art and no
 * defect reproduced — composites across styles/facings/bodies are correct, the face tintmask marks only brows +
 * beard rows, and the lift above puts face/eyes over hair on every face-visible facing. These tests pin the
 * contract so a regression cannot silently reintroduce it: each slot carries its own palette index, so changing
 * the hair colour changes ONLY the hair layer's tint. The one deliberate exception lives in the creator's
 * stepLook (beard follows hair colour) and is pinned in apps/client/test/creator_tints.test.ts, not here.
 */
describe("hair colour vs face tint (Task 24)", () => {
  const stubWear = (id: number, key: string, slot: WearableDef["slot"], layer: number, tintChannels: 0 | 1 | 2): WearableDef =>
    ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer, z: 0, tintChannels }) as unknown as WearableDef;
  const hairW = stubWear(1, "hair_bob", "hair", 40, 2);
  const faceW = stubWear(2, "face_smile", "face", 32, 1);
  const eyesW = stubWear(3, "eyes_round", "eyes", 34, 1);
  const tintCat: CosmeticCatalogLike = {
    wearable: (id) => [hairW, faceW, eyesW].find((w) => w.id === id),
    bodySprite: () => ({ sprite: 1, anim: "idle" }),
    skinTones: [{ index: 0, key: "tan", color: 0xC98D64 }],
    hairColors: [{ index: 0, key: "brown", color: 0x5A3A22 }, { index: 1, key: "red", color: 0xC8321E }],
    clothingColors: [{ index: 0, key: "blue", color: 0x3A5AC8 }, { index: 1, key: "green", color: 0x3AC85A }],
  };
  const look = (hairPrimary: number): AppearanceValue => {
    const parts = new Array(9).fill(0); parts[slotIndex("hair")] = 1; parts[slotIndex("face")] = 2; parts[slotIndex("eyes")] = 3;
    const primary = new Array(9).fill(0); primary[slotIndex("hair")] = hairPrimary;
    return { bodyType: 0, skinTone: 0, parts, primary, secondary: new Array(9).fill(0) };
  };
  it("changing the hair colour changes only the hair layer's tint", () => {
    const before = resolveLayers(tintCat, look(0), Math.PI / 4);
    const after = resolveLayers(tintCat, look(1), Math.PI / 4);
    const layer = (ls: typeof before, slot: string) => ls.find((l) => l.slot === slot)!;
    expect(layer(before, "hair").tintR).toBe(0x5A3A22);
    expect(layer(after, "hair").tintR).toBe(0xC8321E); // the hair really changed colour
    expect(layer(after, "face").tintR).toBe(layer(before, "face").tintR); // the face did NOT follow
    expect(layer(after, "eyes").tintR).toBe(layer(before, "eyes").tintR);
    expect(layer(after, "body").tintR).toBe(layer(before, "body").tintR); // skin untouched
    // and the face still draws over the hair on a face-visible facing (the lift, not the tint, decides depth)
    expect(liftFaceOverHair(after, Math.PI / 4).map((l) => l.slot)).toEqual(["body", "hair", "face", "eyes"]);
  });
});
