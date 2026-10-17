import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadRecipes } from "../src/index.js";

describe("RecipeRegistry", () => {
  const items = new Map([["wood", 1], ["stone", 2], ["fiber", 3], ["stone_axe", 4], ["plank", 5]]);
  const look = { item: (k: string) => items.get(k) ?? 100 + k.length, station: (k: string) => ({ campfire: 1, workbench: 2 } as Record<string, number>)[k] };
  it("loads gameplay's recipes.json format unchanged with its ids", () => {
    // gameplay owns the station keys (data/stations.json) and recipe ids (data/ids.lock.json)
    const json = (f: string) => JSON.parse(readFileSync(new URL(`../../gameplay/data/${f}`, import.meta.url), "utf8"));
    const raw = json("recipes.json"); const stations = json("stations.json").stations as Record<string, number>; const lock = json("ids.lock.json").recipes as Record<string, number>;
    const { registry, errors } = loadRecipes(raw, { item: look.item, station: (k) => stations[k] }, lock); expect(errors).toEqual([]);
    for (const r of raw.recipes) expect(registry.byKey(r.key)!.id).toBe(r.id ?? lock[r.key]);
  });
  it("extended fields, stable ids via lock, validation", () => {
    const raw = [
      { key: "plank", station: "workbench", seconds: 1.5, ingredients: [{ item: "wood", count: 1 }], output: { item: "plank", count: 2 }, outputs: [{ item: "fiber", count: 1 }], unlocks: ["axe"], skill: { key: "carpentry", level: 2 } },
      { key: "axe", seconds: 2, ingredients: [{ item: "plank", count: 2 }], output: { item: "stone_axe", count: 1 } },
    ];
    const a = loadRecipes(raw, look, { axe: 7 }); expect(a.errors).toEqual([]);
    const plank = a.registry.byKey("plank")!; expect(plank).toMatchObject({ station: 2, inputs: [{ item: 1, count: 1 }], outputs: [{ item: 5, count: 2 }, { item: 3, count: 1 }], unlocks: [7] });
    expect(a.registry.ticks(plank.id, 20)).toBe(30); expect(a.registry.forStation(0).map((r) => r.key)).toEqual(["axe"]);
    const b = loadRecipes([...raw].reverse(), look, a.registry.lock); expect(b.registry.byKey("plank")!.id).toBe(plank.id);
    const bad = loadRecipes([{ key: "x", station: "moon", seconds: -1, ingredients: [], unlocks: ["nope"] }], look);
    expect(bad.errors.join()).toMatch(/unknown station.*bad seconds|bad seconds.*unknown station/); expect(bad.errors.join()).toContain("no outputs"); expect(bad.errors.join()).toContain("unlocks unknown");
  });
});
