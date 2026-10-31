// ADR-252 / ADR-245: every AI human gets a stable, valid look; skin tones spread over the whole 18-tone palette.
import { beforeAll, describe, expect, it } from "vitest";
import { validateAppearance, type CosmeticCatalogLike } from "@engine/core";
import { loadServerCatalog } from "../src/main.js";
import { botAppearance } from "../src/appearance.js";

let cat: CosmeticCatalogLike;
beforeAll(async () => { const c = await loadServerCatalog(() => {}); expect(c).toBeDefined(); cat = c!; });

describe("ADR-252 bot appearance", () => {
  it("is deterministic per agent id (same look across restarts / reconnects) and valid for the catalog", () => {
    for (const id of ["bot-0", "bot-1", "agent:7f3a", "x"]) {
      const a = botAppearance(cat, id); expect(botAppearance(cat, id)).toEqual(a);
      expect(validateAppearance(cat, a).value).toBeDefined(); expect(a.skinTone).toBeLessThan(cat.skinTones.length);
    }
  });
  it("spreads skin tones over all 18 tones (ADR-245), not just the legacy 12", () => {
    expect(cat.skinTones.length).toBe(18);
    const tones = new Map<number, number>(); for (let i = 0; i < 360; i++) { const t = botAppearance(cat, `bot-${i}`).skinTone; tones.set(t, (tones.get(t) ?? 0) + 1); }
    expect(tones.size).toBe(18); for (const n of tones.values()) expect(n).toBeGreaterThan(5); // roughly uniform (20 expected each)
    expect([...tones.keys()].some((t) => t >= 12)).toBe(true);
  });
  it("different agents usually look different", () => {
    const keys = new Set<string>(); for (let i = 0; i < 40; i++) keys.add(JSON.stringify(botAppearance(cat, `bot-${i}`))); expect(keys.size).toBeGreaterThan(35);
  });
});
