/**
 * ADR-212 progression reachability: start from bare hands + world-gatherable resources (resource nodes, bare-hand
 * gathering rules, creature loot materials) and walk the recipe / station / harvest-tier graph to a fixpoint.
 * Every tool, weapon, armor tier and crafting station (and every building material tier) must be reachable.
 * Fails with the blocked item and the missing ingredient chain, so a new cycle (e.g. ADR-212's
 * anvil -> hardwood -> tier-2 axe -> anvil) is caught at data-review time.
 */
import { describe, expect, it } from "vitest";
import ai from "../data/ai.json";
import { ItemCategory, bareHandsCan, defaultDefs, pieceCost, type GameDefs } from "../src/index.js";

const GEAR = new Set<number>([ItemCategory.Tool, ItemCategory.Weapon, ItemCategory.Armor, ItemCategory.Clothing]);
interface Reach { items: Set<number>; stations: Set<number>; tools: Map<number, number>; why: Map<number, string> }

export function walk(defs: GameDefs, opts: { skipPiece?: (key: string) => boolean } = {}): Reach {
  const items = new Set<number>(), stations = new Set<number>([0]), tools = new Map<number, number>(), why = new Map<number, string>();
  const loot: number[] = []; // creature loot: materials only (gear drops do not count as a progression route)
  for (const a of Object.values(ai.archetypes as Record<string, { loot?: { item: string }[] | null }>)) for (const l of a.loot ?? []) {
    const id = defs.itemId(l.item); if (!GEAR.has(defs.items.get(id)!.category)) loot.push(id);
  }
  let changed = true;
  const add = (id: number, src: string): void => {
    if (items.has(id)) return; items.add(id); why.set(id, src); changed = true;
    const t = defs.items.get(id)?.tool; if (t && t.tier > (tools.get(t.kind) ?? 0)) tools.set(t.kind, t.tier);
  };
  while (changed) {
    changed = false;
    for (const id of loot) add(id, "creature loot");
    for (const r of defs.resources.values()) {
      const tier = tools.get(r.requiredTool) ?? 0;
      if (r.requiredTool === 0 || tier >= r.minTier) for (const y of r.yields) add(y.item, `${r.key}`);
      else if (bareHandsCan(defs, r) && r.yields[0]) add(r.yields[0].item, `${r.key} (bare hands)`); // ADR-107: first yield only
    }
    for (const p of defs.pieces.values()) {
      if (!p.station || stations.has(p.station) || opts.skipPiece?.(p.key)) continue;
      if (pieceCost(defs, p, p.fixedTier).every((c) => items.has(c.item))) { stations.add(p.station); changed = true; }
    }
    for (const r of defs.recipes.values()) if (stations.has(r.station) && r.ingredients.every((i) => items.has(i.item))) add(r.output.item, `recipe ${r.key}`);
  }
  return { items, stations, tools, why };
}

describe("ADR-212 progression reachability", () => {
  const defs = defaultDefs(); const R = walk(defs);
  const blockers = (id: number): string => {
    const r = [...defs.recipes.values()].filter((x) => x.output.item === id);
    return r.map((x) => `${x.key}@station${x.station}${R.stations.has(x.station) ? "" : "(missing)"} needs ${x.ingredients.filter((i) => !R.items.has(i.item)).map((i) => defs.items.get(i.item)!.key).join(",") || "-"}`).join(" | ") || "no recipe / source";
  };
  it("every tool, weapon, armor and clothing item is reachable from bare hands", () => {
    const missing = [...defs.items.values()].filter((i) => GEAR.has(i.category) && !R.items.has(i.id)).map((i) => `${i.key}: ${blockers(i.id)}`);
    expect(missing).toEqual([]);
  });
  it("every crafting station and every tool kind's top tier is reachable", () => {
    const allStations = new Set([...defs.pieces.values()].map((p) => p.station).filter(Boolean)); allStations.add(0);
    expect([...allStations].filter((s) => !R.stations.has(s))).toEqual([]);
    const top = new Map<number, number>(); for (const i of defs.items.values()) if (i.tool) top.set(i.tool.kind, Math.max(top.get(i.tool.kind) ?? 0, i.tool.tier));
    for (const [k, t] of top) expect(R.tools.get(k), `tool kind ${k}`).toBe(t);
    // every armor / weapon progression tier (1 primitive .. 5 advanced) has at least one reachable item
    for (const cat of [ItemCategory.Armor, ItemCategory.Weapon]) {
      const tiers = new Set([...defs.items.values()].filter((i) => i.category === cat && i.tier > 0).map((i) => i.tier));
      for (const t of tiers) expect([...defs.items.values()].some((i) => i.category === cat && i.tier === t && R.items.has(i.id)), `category ${cat} tier ${t}`).toBe(true);
    }
  });
  it("every building material tier is affordable", () => {
    const f = defs.piece("foundation");
    for (let t = 0; t < defs.tiers.length; t++) expect(pieceCost(defs, f, t).filter((c) => !R.items.has(c.item)).map((c) => defs.items.get(c.item)!.key), `tier ${t}`).toEqual([]);
  });
  it("regression: the anvil is reachable without a tier-2 axe (no anvil -> hardwood -> bronze axe cycle)", () => {
    const anvil = defs.piece("anvil"); const axe2 = defs.itemId("bronze_axe");
    const cost = pieceCost(defs, anvil, anvil.fixedTier).map((c) => defs.items.get(c.item)!.key);
    expect(cost).not.toContain("hardwood");
    // walking with oak/maple trees removed (no hardwood at all) still reaches the anvil and the bronze axe
    const noHard = { ...defs, resources: new Map([...defs.resources].filter(([, r]) => !r.yields.some((y) => y.item === defs.itemId("hardwood")))) } as GameDefs;
    const r = walk(noHard); expect(r.stations.has(anvil.station)).toBe(true); expect(r.items.has(axe2)).toBe(true);
  });
});
