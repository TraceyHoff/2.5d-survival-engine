import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_ID_LOCK, DEFAULT_RAW_DEFS, DefsError, loadDefs, manifestKeys, StationKind, ToolKind, secondsToTicks, type RawDefs } from "../src/index.js";

const clone = (): RawDefs => JSON.parse(JSON.stringify(DEFAULT_RAW_DEFS)) as RawDefs;

describe("data-driven defs", () => {
  it("loads the shipped JSON and resolves keys to numeric ids", () => {
    const d = loadDefs(DEFAULT_RAW_DEFS, { lock: DEFAULT_ID_LOCK });
    const axe = d.recipes.get(d.recipeId("stone_axe"))!;
    expect(axe.output.item).toBe(d.itemId("stone_axe"));
    expect(axe.ingredients.map((i) => i.item)).toEqual([d.itemId("wood"), d.itemId("stone"), d.itemId("fiber")]);
    expect(d.recipes.get(d.recipeId("iron_axe"))!.station).toBe(StationKind.Anvil);
    expect(d.items.get(d.itemId("iron_pickaxe"))!.tool).toEqual({ kind: ToolKind.Pickaxe, tier: 3 });
    expect(d.recipes.get(d.recipeId("iron_ingot"))!.station).toBe(StationKind.Furnace);
    expect(d.resources.get(d.resourceId("tree"))!.requiredTool).toBe(ToolKind.Axe);
  });

  it("keeps old ids stable through the lock (append-only) and retires removed keys", () => {
    const d = loadDefs(DEFAULT_RAW_DEFS, { lock: DEFAULT_ID_LOCK });
    expect(d.itemId("wood")).toBe(1); expect(d.itemId("iron_pickaxe")).toBe(12);
    expect(d.lock.items.campfire_kit).toBe(13); // retired, never reused
    expect(Object.values(d.lock.items)).not.toContain(0);
    expect(new Set(Object.values(d.lock.items)).size).toBe(Object.keys(d.lock.items).length);
    expect(d.resourceId("iron_vein")).toBe(7); expect(d.recipeId("iron_pickaxe")).toBe(7);
  });

  it("the committed data/ids.lock.json is up to date (run pnpm --filter @engine/gameplay lock:ids)", () => {
    const d = loadDefs(DEFAULT_RAW_DEFS, { lock: DEFAULT_ID_LOCK });
    const file = JSON.parse(readFileSync(new URL("../data/ids.lock.json", import.meta.url), "utf8")) as Record<string, Record<string, number>>;
    for (const t of Object.keys(d.lock) as (keyof typeof d.lock)[]) expect(file[t], t).toEqual(d.lock[t]);
  });

  it("resolves manifest keys (Art & Assets) and visual ids through resolveSprite", () => {
    const d = loadDefs(DEFAULT_RAW_DEFS, { lock: DEFAULT_ID_LOCK, resolveSprite: (k) => (k === "wall" ? 77 : undefined) });
    expect(d.piece("wall").visualId).toBe(77); expect(d.piece("floor").visualId).toBe(0);
    const keys = manifestKeys(d);
    expect(keys.pieces).toContain("wall_doorway"); expect(keys.zombies).toEqual(expect.arrayContaining(["zombie_walker", "zombie_runner", "zombie_brute"]));
  });

  it("rejects duplicate keys, unknown item refs and bad enums with a list of issues", () => {
    const raw = clone();
    raw.items.items.push({ ...raw.items.items[0]!, key: "dupe" });
    raw.recipes.recipes[0]!.ingredients[0]!.item = "unobtainium";
    raw.resources.resources[0]!.requiredTool = "spoon";
    try { loadDefs(raw); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(DefsError);
      const issues = (e as DefsError).issues.join("\n");
      expect(issues).toMatch(/duplicate key dupe|tools\/weapons|unknown item "unobtainium"/);
      expect(issues).toMatch(/unknown item "unobtainium"/);
      expect(issues).toMatch(/unknown value "spoon"/);
    }
  });

  it("rejects bad locked ids (0 is reserved for empty slots)", () => {
    expect(() => loadDefs(clone(), { lock: { ...DEFAULT_ID_LOCK, items: { ...DEFAULT_ID_LOCK.items, wood: 0 } } })).toThrow(/bad locked id/);
  });

  it("converts seconds to whole ticks", () => {
    expect(secondsToTicks(2, 1 / 20)).toBe(40);
    expect(secondsToTicks(0.01, 1 / 20)).toBe(1);
    expect(secondsToTicks(0.75, 1 / 20)).toBe(15);
  });
});
