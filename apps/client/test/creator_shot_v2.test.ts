// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { slotIndex, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { creatorShotFromQuery, creatorShotLook, parseBodyParam, showCharacterCreator, slotHasColor2, stepLook } from "../src/character-creator.js";
import { MANIFEST_INDEX, servedManifestIndex } from "../src/manifest-index.js";

const W = (id: number, key: string, slot: WearableDef["slot"], tc: 0 | 1 | 2 = 1): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: tc }) as unknown as WearableDef;
const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
const mk = (hairTc: 0 | 1 | 2): CosmeticCatalogLike => { const parts = [W(1, "hair_short", "hair", hairTc), W(4, "top_tee", "top", 2), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes", 2), W(8, "eyes_round", "eyes")];
  return { wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } }; };

describe("creator shot hook v2", () => {
  it("parses body/sex/freeze/timeout", () => {
    expect(creatorShotFromQuery(new URLSearchParams("creator=2d"))).toBeUndefined();
    expect(creatorShotFromQuery(new URLSearchParams("creator=shot&seed=3&facing=6"))).toEqual({ seed: 3, facing: 6, freeze: false, timeoutMs: 20000 });
    expect(creatorShotFromQuery(new URLSearchParams("creator=shot&body=0&freeze=1&timeout=5000"))).toMatchObject({ body: 0, freeze: true, timeoutMs: 5000 });
    expect(creatorShotFromQuery(new URLSearchParams("creator=shot&sex=f"))?.body).toBe(1);
    expect(creatorShotFromQuery(new URLSearchParams("creator=shot&body=male&sex=f"))?.body).toBe(0);
    expect(parseBodyParam("9")).toBeUndefined(); expect(parseBodyParam("robot")).toBeUndefined(); expect(parseBodyParam("Female")).toBe(1);
  });
  it("body overrides the seed's body roll, deterministically", () => {
    const cat = mk(1);
    for (const seed of [1, 2, 3, 4]) for (const b of [0, 1]) { const a = creatorShotLook(cat, seed, b); expect(a.bodyType).toBe(b); expect(creatorShotLook(cat, seed, b)).toEqual(a); }
    expect(creatorShotLook(cat, 1)).toEqual(creatorShotLook(cat, 1, undefined));
  });
  it("hair secondary row only when the catalog has color2 hair", async () => {
    expect(slotHasColor2(mk(1), "hair")).toBe(false); expect(slotHasColor2(mk(2), "hair")).toBe(true);
    const v = creatorShotLook(mk(2), 1); const s = stepLook(mk(2), v, "hair:color2", 1);
    expect(s.secondary[slotIndex("hair")]).toBe(((v.secondary[slotIndex("hair")] ?? 0) + 1) % 5); expect(s.secondary[slotIndex("top")]).toBe(v.secondary[slotIndex("top")]);
    for (const [tc, n] of [[1, 0], [2, 1]] as const) {
      const p = showCharacterCreator({ root: document.body, catalog: mk(tc), pads: () => [], initial: { v: 1, name: "A", appearance: v } });
      expect(document.querySelectorAll('[data-action="next-hair:color2"]').length).toBe(n);
      document.querySelector<HTMLButtonElement>('[data-action="creator-back"]')!.click(); await p;
    }
  });
  it("manifest index lists only served optional fragments", () => {
    const idx = servedManifestIndex((u) => u.includes("nature"));
    expect(idx.fragments.map((f) => f.name)).toEqual(["pack", "nature"]);
    expect(MANIFEST_INDEX.find((f) => f.name === "items")?.optional).toBe(true);
  });
});
