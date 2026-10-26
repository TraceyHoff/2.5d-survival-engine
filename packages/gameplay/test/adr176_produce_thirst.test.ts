import { describe, it, expect } from "vitest";
import { defaultDefs } from "../src/index.js";

const d = defaultDefs(); const food = (k: string) => d.items.get(d.itemId(k))!.food!;
/** ADR-176: raw berries, fruits and crops restore a little water (thirst is 0..100), scaled by how juicy they are. */
export const RAW_PRODUCE: Record<string, number> = {
  berries: 6, blueberry: 6, raspberry: 6, blackberry: 6, strawberry: 7, cherry: 6, apple: 7, pear: 8, peach: 8, orange: 10, coconut: 14,
  tomato: 9, cabbage: 6, pumpkin: 6, squash: 6, carrot: 5, corn: 5, potato: 4, onion: 4, wild_onion: 4, beans: 3, garlic: 2, mushroom: 3,
};
describe("ADR-176 raw produce hydrates", () => {
  it("every raw berry / fruit / crop restores a small, scaled amount of thirst (data-driven in items.json)", () => {
    for (const [k, v] of Object.entries(RAW_PRODUCE)) { expect(food(k).thirst, k).toBe(v); expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(14); }
    expect(food("orange").thirst).toBeGreaterThan(food("potato").thirst); // juicier = more water
  });
  it("cooked / meat items are unchanged", () => {
    expect(food("cooked_meat").thirst).toBe(0); expect(food("raw_meat").thirst).toBe(0); expect(food("jerky").thirst).toBe(-4); expect(food("bread").thirst).toBe(-2);
  });
});
