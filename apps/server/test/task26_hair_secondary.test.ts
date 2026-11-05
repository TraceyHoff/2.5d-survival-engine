// Task 26: AI humans in the world showed the same black bars — randomAppearance rolled a random
// hair secondary, and palette index 0 is black. Bot hair/face secondaries now follow the primary.
import { beforeAll, describe, expect, it } from "vitest";
import { slotIndex, type CosmeticCatalogLike } from "@engine/core";
import { loadServerCatalog } from "../src/main.js";
import { botAppearance, randomAppearance } from "../src/appearance.js";

let cat: CosmeticCatalogLike;
beforeAll(async () => { const c = await loadServerCatalog(() => {}); expect(c).toBeDefined(); cat = c!; });

describe("Task 26: bot hair/face never carries a black secondary", () => {
  it("randomAppearance rolls uniform hair/face (secondary == primary) over many seeds", () => {
    let s = 12345; const rnd = (): number => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 200; i++) {
      const a = randomAppearance(cat, rnd);
      expect(a.secondary[slotIndex("hair")]).toBe(a.primary[slotIndex("hair")]);
      expect(a.secondary[slotIndex("face")]).toBe(a.primary[slotIndex("face")]);
    }
  });
  it("botAppearance is deterministic and uniform-haired for every agent", () => {
    for (let i = 0; i < 40; i++) {
      const a = botAppearance(cat, `bot-${i}`);
      expect(botAppearance(cat, `bot-${i}`)).toEqual(a);
      expect(a.secondary[slotIndex("hair")]).toBe(a.primary[slotIndex("hair")]);
      expect(a.secondary[slotIndex("face")]).toBe(a.primary[slotIndex("face")]);
    }
  });
});
