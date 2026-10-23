import { describe, expect, it } from "vitest";
import en from "../data/locale/en.json";
import { populationData } from "../src/index.js";

describe("en locale", () => {
  const text = en as Record<string, string>;
  const keys = Object.values(populationData().bots.archetypes).flatMap((a) => Object.values(a.chat).flat());
  it("has short text for every bot chat key", () => {
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(typeof text[k], k).toBe("string");
      expect(text[k]!.trim().length, k).toBeGreaterThan(0);
      expect(text[k]!.length, k).toBeLessThanOrEqual(48);
    }
  });
  it("has no orphan bot keys", () => {
    const used = new Set(keys);
    expect(Object.keys(text).filter((k) => k.startsWith("bot.") && !used.has(k))).toEqual([]);
  });
});
