// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SLOT_COUNT, slotIndex, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import { cleanName, creatorOptions, loadCharacter, randomLook, saveCharacter, showCharacterCreator, stepLook } from "../src/character-creator.js";

const W = (id: number, key: string, slot: WearableDef["slot"], tags: string[] = [], bodies: string[] = ["male", "female"]): WearableDef =>
  ({ id, key, slot, bodies: Object.fromEntries(bodies.map((b) => [b, { sprite: 1, anim: "idle" }])), hidesSlots: [], hatHair: false, unlockTags: tags, layer: 0, z: 0, tintChannels: 1 }) as unknown as WearableDef;
const parts = [W(1, "hair_short", "hair"), W(2, "hair_long", "hair", [], ["female"]), W(3, "face_beard", "face", [], ["male"]), W(4, "top_tee", "top"), W(5, "top_gold", "top", ["vip"]), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes"), W(8, "eyes_round", "eyes")];
const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
const cat: CosmeticCatalogLike = { wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } };

describe("ADR-114 character creator", () => {
  it("options exclude unlock-gated and incompatible parts", () => {
    const m = creatorOptions(cat, 0); expect(m.top.map((w) => w.id)).toEqual([4]); expect(m.hair.map((w) => w.id)).toEqual([1]); expect(m.face.map((w) => w.id)).toEqual([3]);
    expect(creatorOptions(cat, 1).hair.map((w) => w.id)).toEqual([1, 2]);
  });
  it("randomize stays within starter options", () => {
    let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) { const v = randomLook(cat, rnd); expect(v.parts).toHaveLength(SLOT_COUNT); expect(v.parts[slotIndex("top")]).toBe(4); expect(v.skinTone).toBeLessThan(6);
      if (v.bodyType === 0) expect(v.parts[slotIndex("hair")]).not.toBe(2); }
  });
  it("step cycles parts (with None for hair/face), colours and fixes parts on body change", () => {
    let v = randomLook(cat, () => 0.99); v = { ...v, bodyType: 1 }; v.parts[slotIndex("hair")] = 2;
    const m = stepLook(cat, v, "body", 1); expect(m.bodyType).toBe(0); expect(m.parts[slotIndex("hair")]).not.toBe(2);
    const h0 = stepLook(cat, { ...m, parts: m.parts.map((p, i) => (i === slotIndex("hair") ? 0 : p)) }, "hair", 1); expect(h0.parts[slotIndex("hair")]).toBe(1);
    const c = stepLook(cat, h0, "hair:color", -1); expect(c.primary[slotIndex("hair")]).toBe(((h0.primary[slotIndex("hair")]! - 1) % 5 + 5) % 5); expect(c.primary[slotIndex("face")]).toBe(c.primary[slotIndex("hair")]);
  });
  it("names are cleaned; stored per save", () => {
    expect(cleanName("  <b>Ann\u0007ie   Z  ")).toBe("bAnnie Z"); expect(cleanName("x".repeat(40))).toHaveLength(20);
    const m = new Map<string, string>(); const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    saveCharacter("singleplayer", "1", { v: 1, name: "Ann", appearance: randomLook(cat) }, st);
    expect(loadCharacter("singleplayer", "1", st)?.name).toBe("Ann"); expect(loadCharacter("hosted", "1", st)).toBeUndefined(); expect(loadCharacter("singleplayer", "2", st)).toBeUndefined();
  });
  it("panel lays out as wrapping rows, not columns, under the boot .panel rule (phone: Enter world stays on screen)", async () => {
    const st = document.createElement("style"); st.textContent = ".boot .panel{display:flex;flex-direction:column}"; document.head.append(st);
    const p = showCharacterCreator({ root: document.body, catalog: cat, pads: () => [] });
    const panel = document.querySelector<HTMLElement>("[data-boot=creator] .panel")!; expect(getComputedStyle(panel).flexDirection).toBe("row"); expect(panel.style.flexWrap).toBe("wrap");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await p; st.remove();
  });
  it("dialog: requires a name, Randomize, keyboard step, Enter world, and Back / Esc", async () => {
    const p = showCharacterCreator({ root: document.body, catalog: cat, pads: () => [] });
    const q = (a: string) => document.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)!;
    q("creator-done").click(); expect(document.querySelector("[data-role=creator-msg]")!.textContent).toMatch(/name/);
    const before = document.querySelector("[data-role=creator-skin]")!.textContent; q("next-skin").click(); expect(document.querySelector("[data-role=creator-skin]")!.textContent).not.toBe(before);
    q("randomize").click();
    const inp = document.querySelector<HTMLInputElement>("[data-role=creator-name]")!; inp.value = "Zed"; inp.dispatchEvent(new Event("input"));
    q("creator-done").click(); const r = await p; expect(r?.name).toBe("Zed"); expect(document.querySelector("[data-boot=creator]")).toBeNull();
    const p2 = showCharacterCreator({ root: document.body, catalog: cat, initial: r, pads: () => [] });
    expect(document.querySelector("h2")!.textContent).toMatch(/Edit/);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(await p2).toBeUndefined();
  });
});
