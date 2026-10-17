import { describe, it, expect } from "vitest";
import { addItem, canAddItem, countItem, defaultDefs, Inventory, listSlots, removeItem, spawnPlayer, transferItem } from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = defaultDefs();
const WOOD = d.itemId("wood"), STONE = d.itemId("stone"), AXE = d.itemId("stone_axe"), ORE = d.itemId("iron_ore");

describe("inventory", () => {
  it("stacks up to maxStack, then spills into new slots", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
    expect(addItem(w, p, WOOD, 30)).toBe(30);
    expect(addItem(w, p, WOOD, 30)).toBe(30); // maxStack 50 -> 50 + 10
    expect(listSlots(w, p)).toEqual([{ slot: 0, item: WOOD, count: 50 }, { slot: 1, item: WOOD, count: 10 }]);
    expect(addItem(w, p, AXE, 2)).toBe(2); // maxStack 1 -> two slots
    expect(listSlots(w, p).filter((s) => s.item === AXE).length).toBe(2);
  });

  it("is limited by slot count", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0, slots: 2, maxWeight: 0 });
    expect(addItem(w, p, AXE, 5)).toBe(2);
    expect(canAddItem(w, p, WOOD, 1)).toBe(0);
  });

  it("is limited by weight and caches total weight in the component", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0, maxWeight: 10 });
    expect(addItem(w, p, ORE, 10)).toBe(5); // 2 kg each
    expect(w.getField(p, Inventory, "weight")).toBeCloseTo(10);
    expect(addItem(w, p, d.itemId("fiber"), 1)).toBe(0);
  });

  it("removes all-or-nothing, from the last stack first", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
    addItem(w, p, WOOD, 60);
    expect(removeItem(w, p, WOOD, 61)).toBe(false);
    expect(countItem(w, p, WOOD)).toBe(60);
    expect(removeItem(w, p, WOOD, 15)).toBe(true);
    expect(listSlots(w, p)).toEqual([{ slot: 0, item: WOOD, count: 45 }]);
  });

  it("transfers what fits and marks both inventories changed", () => {
    const w = makeWorld(); const a = spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 }); const chest = spawnPlayer(w, { x: 1, y: 0, slots: 1, maxWeight: 0 });
    addItem(w, a, STONE, 80);
    w.clearChanges();
    expect(transferItem(w, a, chest, STONE, 80)).toBe(50);
    expect(countItem(w, a, STONE)).toBe(30);
    expect(countItem(w, chest, STONE)).toBe(50);
    expect([...w.changed(Inventory)].sort()).toEqual([a, chest].sort());
  });
});
