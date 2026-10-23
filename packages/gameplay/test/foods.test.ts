import { describe, it, expect } from "vitest";
import {
  addItem, countItem, defaultDefs, fillContainer, freshnessStage, IntentAction, itemInfo, setIntent, spawnPlayer, spoilStages, Survival,
} from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = defaultDefs();
describe("foods, spoilage stages, water flask", () => {
  it("new foods and recipes load", () => {
    for (const k of ["mushroom", "carrot", "apple", "fish", "cooked_fish", "bread", "stew_bowl", "egg"]) expect(d.items.get(d.itemId(k))?.food).toBeTruthy();
    expect(spoilStages(d).map((s) => s.key)).toEqual(["fresh", "stale", "spoiling", "rotten"]);
  });
  it("freshnessStage follows data stages", () => {
    const st = spoilStages(d);
    expect([1, 0.6, 0.3, 0.05].map((f) => freshnessStage(f, st))).toEqual([0, 1, 2, 3]);
  });
  it("water flask: sip per use, stays when empty, refills, itemInfo.fill", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 }); const flask = d.itemId("water_flask");
    const def = d.items.get(flask)!; expect(def.sips).toBe(4);
    addItem(w, p, flask, 1); expect(itemInfo(w, p, 0)!.fill).toBe(1);
    for (let i = 0; i < 5; i++) { w.set(p, Survival, { thirst: 10 }); setIntent(w, p, { action: IntentAction.Use, slot: 0 }); w.step(1 / 20); setIntent(w, p, { action: IntentAction.None }); w.step(1 / 20); }
    expect(countItem(w, p, flask)).toBe(1); expect(itemInfo(w, p, 0)!.fill).toBe(0);
    expect(w.get(p, Survival)!.thirst).toBeLessThan(11); // empty flask: no drink
    expect(fillContainer(w, p, 0)).toBe(4); expect(itemInfo(w, p, 0)!.fill).toBe(1);
    expect(itemInfo(w, p, 0)).toBeTruthy(); addItem(w, p, d.itemId("berries"), 1); expect(itemInfo(w, p, 1)!.fill).toBeUndefined();
  });
});
