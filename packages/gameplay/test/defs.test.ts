import { describe, it, expect } from "vitest";
import { DEFAULT_RAW_DEFS, DefsError, loadDefs, StationKind, ToolKind, secondsToTicks, type RawDefs } from "../src/index.js";

const clone = (): RawDefs => JSON.parse(JSON.stringify(DEFAULT_RAW_DEFS)) as RawDefs;

describe("data-driven defs", () => {
  it("loads the shipped JSON and resolves keys to numeric ids", () => {
    const d = loadDefs(DEFAULT_RAW_DEFS);
    const axe = d.recipes.get(d.recipeId("stone_axe"))!;
    expect(axe.output.item).toBe(d.itemId("stone_axe"));
    expect(axe.ingredients.map((i) => i.item)).toEqual([d.itemId("wood"), d.itemId("stone"), d.itemId("fiber")]);
    expect(d.recipes.get(d.recipeId("iron_axe"))!.station).toBe(StationKind.Workbench);
    expect(d.items.get(d.itemId("iron_pickaxe"))!.tool).toEqual({ kind: ToolKind.Pickaxe, tier: 2 });
    expect(d.resources.get(d.resourceId("tree"))!.requiredTool).toBe(ToolKind.Axe);
  });

  it("rejects duplicate ids, unknown item refs and bad enums with a list of issues", () => {
    const raw = clone();
    raw.items.items.push({ ...raw.items.items[0]!, key: "dupe" });
    raw.recipes.recipes[0]!.ingredients[0]!.item = "unobtainium";
    raw.resources.resources[0]!.requiredTool = "spoon";
    try { loadDefs(raw); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(DefsError);
      const issues = (e as DefsError).issues.join("\n");
      expect(issues).toMatch(/duplicate id 1/);
      expect(issues).toMatch(/unknown item "unobtainium"/);
      expect(issues).toMatch(/unknown value "spoon"/);
    }
  });

  it("rejects id 0 (reserved for empty slots) and ids beyond u16", () => {
    const raw = clone(); raw.items.items[0]!.id = 0;
    expect(() => loadDefs(raw)).toThrow(/must be an integer in 1\.\.65535/);
  });

  it("converts seconds to whole ticks", () => {
    expect(secondsToTicks(2, 1 / 20)).toBe(40);
    expect(secondsToTicks(0.01, 1 / 20)).toBe(1);
    expect(secondsToTicks(0.75, 1 / 20)).toBe(15);
  });
});
