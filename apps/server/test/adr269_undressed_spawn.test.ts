// ADR-269: AI humans (and the server's random join look) start undressed like a creator survivor: body features only.
// Clothing shows only once they craft / loot and wear it (Worn -> data/wear_cosmetics.json), exactly like the player.
import { beforeAll, describe, expect, it } from "vitest";
import { WEARABLE_SLOTS, slotIndex, validateAppearance, type CosmeticCatalogLike } from "@engine/core";
import { wearableKeyFor } from "@engine/gameplay";
import { loadServerCatalog } from "../src/main.js";
import { SPAWN_LOOK_SLOTS, botAppearance, randomAppearance } from "../src/appearance.js";

let cat: CosmeticCatalogLike;
beforeAll(async () => { const c = await loadServerCatalog(() => {}); expect(c).toBeDefined(); cat = c!; });
const CLOTHING = WEARABLE_SLOTS.filter((s) => !SPAWN_LOOK_SLOTS.includes(s));

describe("ADR-269 undressed spawn looks", () => {
  it("clothing slots are hat / accessory / top / bottom / shoes / hands", () => {
    expect([...CLOTHING].sort()).toEqual(["accessory", "bottom", "hands", "hat", "shoes", "top"]);
  });
  it("every AI human look has no clothing parts, keeps hair / face / eyes, and is valid", () => {
    let hair = 0;
    for (let i = 0; i < 200; i++) {
      const a = botAppearance(cat, `bot-${i}`);
      for (const s of CLOTHING) expect(a.parts[slotIndex(s)], `bot-${i} ${s}`).toBe(0);
      expect(a.parts[slotIndex("eyes")]).toBeGreaterThan(0); if (a.parts[slotIndex("hair")]) hair++;
      expect(validateAppearance(cat, a).value).toEqual(a);
    }
    expect(hair).toBeGreaterThan(150);
  });
  it("the random join look is undressed too", () => {
    let s = 7; const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 100; i++) { const a = randomAppearance(cat, rnd); for (const sl of CLOTHING) expect(a.parts[slotIndex(sl)]).toBe(0); }
  });
  it("crafted clothes still have their worn looks (AI humans dress the same way the player does)", () => {
    for (const k of ["cloth_mask", "straw_hat", "linen_shirt", "linen_trousers", "reed_sandals", "leather_gloves"]) expect(wearableKeyFor(k, undefined), k).toBeTruthy();
  });
});
