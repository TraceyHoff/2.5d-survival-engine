// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { slotIndex, validateAppearance, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { EYE_COLOR_KEYS, SECONDARY_SLOTS, colorChoices, creatorShotFromQuery, creatorShotLook, loadCharacter, randomLook, saveCharacter, showCharacterCreator, stepLook } from "../src/character-creator.js";

const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: 2 }) as unknown as WearableDef;
const parts = [W(1, "hair_short", "hair"), W(4, "top_tee", "top"), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes"), W(8, "eyes_round", "eyes")];
const manifest = JSON.parse(readFileSync("packages/assets/pack/customization/manifest.customization.json", "utf8")) as Record<string, { key: string; color: string }[]>;
const pal = (k: string) => manifest[k]!.map((c, index) => ({ index, key: c.key, color: parseInt(c.color.slice(1), 16) }));
const cat: CosmeticCatalogLike = { wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: pal("skinTones"), hairColors: pal("hairColors"), clothingColors: pal("clothingColors"), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } };
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;
const dist = (a: number, b: number) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

describe("creator eye / shoe / secondary colour rows", () => {
  it("palettes: mustard and gold are clearly distinct; every clothing colour is distinguishable", () => {
    const c = cat.clothingColors; const by = (k: string) => c.find((x) => x.key === k)!.color;
    expect(dist(by("mustard"), by("gold"))).toBeGreaterThan(60);
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(dist(c[i]!.color, c[j]!.color), `${c[i]!.key}/${c[j]!.key}`).toBeGreaterThan(25);
    expect(colorChoices(cat, "eyes").length).toBe(EYE_COLOR_KEYS.length); // all curated keys exist in the pack
  });
  it("step: eyes cycle the curated list, shoes the clothing palette, secondary drives every 2-channel slot", () => {
    let v = randomLook(cat, () => 0.3); const eyes = colorChoices(cat, "eyes"); const seen = new Set<number>();
    for (let i = 0; i < eyes.length; i++) { v = stepLook(cat, v, "eyes:color", 1); seen.add(v.primary[slotIndex("eyes")]!); }
    expect([...seen].sort()).toEqual([...eyes].sort());
    const s0 = v.primary[slotIndex("shoes")]!; v = stepLook(cat, v, "shoes:color", -1); expect(v.primary[slotIndex("shoes")]).toBe((s0 - 1 + cat.clothingColors.length) % cat.clothingColors.length);
    v = stepLook(cat, v, "secondary", 3); const sec = v.secondary[slotIndex("top")]; for (const s of SECONDARY_SLOTS) expect(v.secondary[slotIndex(s)]).toBe(sec);
    // server validation, wire and save keep the new tints
    expect(validateAppearance(cat, v, { mode: "reject" }).issues).toEqual([]);
    const m = new Map<string, string>(); saveCharacter("singleplayer", "t", { v: 1, name: "T", appearance: v }, { getItem: (k) => m.get(k) ?? null, setItem: (k, x) => void m.set(k, x), removeItem: () => undefined });
    expect(loadCharacter("singleplayer", "t", { getItem: (k) => m.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined })?.appearance).toEqual(v);
  });
  it("dialog rows work with mouse/touch buttons, keyboard arrows and a gamepad", async () => {
    let pad: Gamepad | null = null; const p = showCharacterCreator({ root: document.body, catalog: cat, pads: () => [pad] });
    const q = (a: string) => document.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)!; const val = (f: string) => document.querySelector<HTMLElement>(`[data-role="creator-${f}"]`)!;
    for (const f of ["eyes:color", "shoes:color", "secondary"]) { expect(q(`next-${f}`).style.minHeight).toBe("44px"); const b = val(f).textContent; q(`next-${f}`).click(); expect(val(f).textContent).not.toBe(b); expect(val(f).dataset["swatch"]).toMatch(/^#[0-9a-f]{6}$/); }
    q("next-eyes:color").focus(); const b = val("eyes:color").textContent; document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); expect(val("eyes:color").textContent).not.toBe(b);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(await p).toBeUndefined();
  });
  it("?creator=shot&seed=N is deterministic and signals ready", async () => {
    expect(creatorShotFromQuery(new URLSearchParams("creator=2d"))).toBeUndefined();
    expect(creatorShotFromQuery(new URLSearchParams("creator=shot&seed=42&facing=-1"))).toEqual({ seed: 42, facing: 7 });
    expect(creatorShotFromQuery(new URLSearchParams("creator=shot"))).toEqual({ seed: 1, facing: 1 });
    expect(creatorShotLook(cat, 42)).toEqual(creatorShotLook(cat, 42)); expect(creatorShotLook(cat, 42)).not.toEqual(creatorShotLook(cat, 43));
    const ready = new Promise<string>((r) => { void showCharacterCreator({ root: document.body, catalog: cat, initial: { v: 1, name: "S", appearance: creatorShotLook(cat, 42) }, pads: () => [], shot: { facing: 2, onReady: (i) => r(i.renderer) } }); });
    expect(await ready).toBe("sketch"); expect(document.querySelector<HTMLElement>("[data-boot=creator]")!.dataset["ready"]).toBe("1");
  });
});
