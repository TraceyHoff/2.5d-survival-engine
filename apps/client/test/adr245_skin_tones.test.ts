// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SKIN_TONE_SCHEME, SLOT_COUNT, defaultAppearance, type CosmeticCatalogLike } from "@engine/core";
import { characterKey, loadCharacter, migrateStoredSkin, showCharacterCreator, type StoredCharacter } from "../src/character-creator.js";
import { catalogFromSnapshot, snapshotCatalog } from "../src/catalog-snapshot.js";

/** ADR-245: 18 realistic skin tones; swatches show ramp.base; legacy stored characters remap once. */
const tones = Array.from({ length: 18 }, (_, i) => ({ index: i, key: `tone_${i}`, color: 0x808080, ramp: { base: 0x100000 * (i % 15) + 0x2040 + i, shadow: 0x101010, highlight: 0xf0f0f0 } }));
const art = { sprite: 1, anim: "idle" };
const cat: CosmeticCatalogLike = { wearable: () => undefined, bodySprite: () => art, skinTones: tones, hairColors: [{ index: 0, key: "h", color: 1 }], clothingColors: [{ index: 0, key: "c", color: 2 }], hash: 0x1234abcd };
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const store = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe("ADR-245 skin tones (client)", () => {
  it("legacy localStorage character: 9 (ebony) -> 16, 11 (goblin) -> 8, re-saved with skinScheme; idempotent", () => {
    for (const [old, now] of [[9, 16], [11, 8], [3, 6]] as const) {
      const st = store(); const look = { ...defaultAppearance(cat, 0), skinTone: old };
      st.setItem(characterKey("singleplayer", "1"), JSON.stringify({ v: 1, name: "Old", appearance: look }));
      const a = loadCharacter("singleplayer", "1", st)!; expect(a.appearance.skinTone).toBe(now); expect(a.skinScheme).toBe(SKIN_TONE_SCHEME);
      expect(JSON.parse(st.m.get(characterKey("singleplayer", "1"))!).skinScheme).toBe(SKIN_TONE_SCHEME);
      expect(loadCharacter("singleplayer", "1", st)!.appearance.skinTone).toBe(now); // second load: no double remap
    }
    const cur: StoredCharacter = { v: 1, name: "New", appearance: { ...defaultAppearance(cat, 0), skinTone: 9 }, skinScheme: SKIN_TONE_SCHEME };
    let resaved = 0; expect(migrateStoredSkin(cur, () => resaved++)).toBe(cur); expect(resaved).toBe(0);
  });
  it("creator shows all 18 tones as ramp.base swatches; clicking one selects it", async () => {
    document.body.innerHTML = "";
    const p = showCharacterCreator({ root: document.body, catalog: cat, pads: () => [] });
    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-role=creator-skin-swatches] button"));
    expect(chips).toHaveLength(18);
    chips.forEach((b, i) => { expect(b.dataset["swatch"]).toBe(hex(tones[i]!.ramp.base)); expect(b.getAttribute("aria-label")).toBe(`tone ${i}`); });
    chips[13]!.click(); expect(chips[13]!.getAttribute("aria-checked")).toBe("true"); expect(chips.filter((b) => b.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(document.querySelector<HTMLElement>("[data-role=creator-skin]")!.dataset["swatch"]).toBe(hex(tones[13]!.ramp.base)); // not .color
    const inp = document.querySelector<HTMLInputElement>("[data-role=creator-name]")!; inp.value = "Ivo"; inp.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>("[data-action=creator-done]")!.click();
    const r = await p; expect(r?.appearance.skinTone).toBe(13); expect(r?.skinScheme).toBe(SKIN_TONE_SCHEME); expect(r?.appearance.parts).toHaveLength(SLOT_COUNT);
  });
  it("worker catalog snapshot keeps the cosmetics hash (the in-process server checks it)", () => {
    const back = catalogFromSnapshot(structuredClone(snapshotCatalog(cat)));
    expect(back.hash).toBe(0x1234abcd); expect(back.skinTones[5]!.ramp).toEqual(tones[5]!.ramp);
  });
});
