import { describe, it, expect } from "vitest";
import { Transform } from "@engine/core";
import {
  addItem, countItem, CraftCompleted, CraftFail, CraftFailed, Crafter, craftProgressTicks, CraftStarted, defaultDefs, Fuel, IntentAction,
  removeItem, setIntent, spawnPlayer, spawnStation, StationKind,
} from "../src/index.js";
import { collect, makeWorld, steps, spawnLearned } from "./helpers.js";

const d = defaultDefs();
const id = (k: string) => d.itemId(k);
const strip = <T extends { tick: number }>(xs: T[]) => xs.map(({ tick: _t, ...r }) => r);

function crafter(role: "standalone" | "client" = "standalone") {
  const w = makeWorld({ role }); const p = spawnLearned(w, { x: 0, y: 0, maxWeight: 0 });
  return { w, p, done: collect(w, CraftCompleted), failed: collect(w, CraftFailed), started: collect(w, CraftStarted) };
}

describe("crafting", () => {
  it("crafts a stone axe after recipe seconds, consuming ingredients at completion; progress is derived from startTick", () => {
    const { w, p, done, started } = crafter();
    addItem(w, p, id("wood"), 5); addItem(w, p, id("stone"), 2); addItem(w, p, id("fiber"), 2);
    setIntent(w, p, { action: IntentAction.Craft, recipe: d.recipeId("stone_axe") });
    w.step(1 / 20);
    expect(strip(started)).toEqual([{ entity: p, recipe: d.recipeId("stone_axe"), totalTicks: 40 }]);
    const start = w.get(p, Crafter)!.startTick;
    steps(w, 39);
    expect(countItem(w, p, id("stone_axe"))).toBe(0);
    expect(craftProgressTicks(w, p)).toBe(39);
    expect(w.get(p, Crafter)!.startTick).toBe(start); // no per-tick writes
    w.step(1 / 20);
    expect(countItem(w, p, id("stone_axe"))).toBe(1);
    expect(countItem(w, p, id("wood"))).toBe(2);
    expect(countItem(w, p, id("stone"))).toBe(0);
    expect(done).toHaveLength(1);
    expect(done[0]!.tick).toBeGreaterThan(0);
    expect(w.get(p, Crafter)!.recipe).toBe(0);
  });

  it("the client predicts progress but never creates the item (it arrives by replication)", () => {
    const { w, p, done } = crafter("client");
    addItem(w, p, id("wood"), 1);
    setIntent(w, p, { action: IntentAction.Craft, recipe: d.recipeId("sticks") });
    steps(w, 40);
    expect(countItem(w, p, id("sticks"))).toBe(0);
    expect(done).toHaveLength(0);
    expect(craftProgressTicks(w, p)).toBe(20); // clamped at totalTicks; server state clears the job
  });

  it("fails without ingredients", () => {
    const { w, p, failed } = crafter();
    addItem(w, p, id("wood"), 3);
    setIntent(w, p, { action: IntentAction.Craft, recipe: d.recipeId("stone_axe") });
    w.step(1 / 20);
    expect(failed[0]!.reason).toBe(CraftFail.MissingIngredients);
  });

  it("needs the right station in range (fired stations must be lit), and cancels if the crafter walks away", () => {
    const { w, p, failed, done } = crafter();
    addItem(w, p, id("iron_ore"), 4); addItem(w, p, id("charcoal"), 2);
    const smelt = d.recipeId("iron_ingot");
    setIntent(w, p, { action: IntentAction.Craft, recipe: smelt }); w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.NoStation);
    spawnStation(w, StationKind.Workbench, 1, 0);
    setIntent(w, p, { action: IntentAction.Craft, recipe: smelt }); w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.NoStation); // wrong kind
    const cold = spawnStation(w, StationKind.Furnace, 1, 1, { burnSeconds: 0 });
    expect(w.get(cold, Fuel)!.lit).toBe(0);
    setIntent(w, p, { action: IntentAction.Craft, recipe: smelt }); w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.NoStation); // unlit furnace
    spawnStation(w, StationKind.Furnace, 1, 0);
    setIntent(w, p, { action: IntentAction.Craft, recipe: smelt }); w.step(1 / 20);
    expect(w.get(p, Crafter)!.recipe).toBe(smelt);
    steps(w, 100);
    expect(done).toHaveLength(1);
    expect(countItem(w, p, id("iron_ingot"))).toBe(1);
    setIntent(w, p, { action: IntentAction.Craft, recipe: smelt }); w.step(1 / 20);
    w.set(p, Transform, { x: 50 });
    w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.NoStation);
    expect(w.get(p, Crafter)!.recipe).toBe(0);
    expect(countItem(w, p, id("iron_ore"))).toBe(2); // nothing consumed by the cancelled job
  });

  it("fails at completion if ingredients were removed mid-craft (no refunds needed)", () => {
    const { w, p, failed, done } = crafter();
    addItem(w, p, id("wood"), 3); addItem(w, p, id("stone"), 2); addItem(w, p, id("fiber"), 2);
    setIntent(w, p, { action: IntentAction.Craft, recipe: d.recipeId("stone_axe") }); w.step(1 / 20);
    removeItem(w, p, id("stone"), 1);
    steps(w, 60);
    expect(done).toHaveLength(0);
    expect(failed.at(-1)!.reason).toBe(CraftFail.MissingIngredients);
    expect(countItem(w, p, id("wood"))).toBe(3);
  });

  it("rejects when the output would not fit, when busy, cancel, and unknown recipes", () => {
    const { w, p, failed } = crafter();
    setIntent(w, p, { action: IntentAction.Craft, recipe: 999 }); w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.UnknownRecipe);
    addItem(w, p, id("wood"), 10);
    setIntent(w, p, { action: IntentAction.Craft, recipe: d.recipeId("wooden_club") }); w.step(1 / 20);
    setIntent(w, p, { action: IntentAction.Craft, recipe: d.recipeId("wooden_club") }); w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.Busy);
    setIntent(w, p, { action: IntentAction.CancelCraft }); w.step(1 / 20);
    expect(failed.at(-1)!.reason).toBe(CraftFail.Cancelled);

    const tight = spawnLearned(w, { x: 0, y: 0, slots: 2, maxWeight: 0 });
    // two full stacks: ingredients exist, but both slots stay occupied after consumption
    addItem(w, tight, id("wood"), 50); addItem(w, tight, id("stone"), 50);
    setIntent(w, tight, { action: IntentAction.Craft, recipe: d.recipeId("wooden_club") }); w.step(1 / 20);
    expect(failed.at(-1)).toMatchObject({ entity: tight, recipe: d.recipeId("wooden_club"), reason: CraftFail.InventoryFull });
  });
});
