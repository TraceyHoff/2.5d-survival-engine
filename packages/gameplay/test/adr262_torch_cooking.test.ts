import { describe, expect, it } from "vitest";
import type { Entity, World } from "@engine/core";
import * as G from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs();
const id = (k: string): number => d.itemId(k);
const mk = (w: World, pid: number, x = 0, y = 0): Entity => G.spawnPlayer(w, { x, y, clientId: pid });
const hold = (w: World, p: Entity, key: string): void => {
  if (!G.countItem(w, p, id(key))) G.addItem(w, p, id(key), 1);
  let slot = 0; while (G.slotItem(w, p, slot).item !== id(key)) slot++;
  w.set(p, G.Equipment, { mainHandSlot: slot, mainHandItem: id(key) });
};
const boil = (w: World, p: Entity): void => { G.setIntent(w, p, { action: G.IntentAction.Boil, slot: 0 }); w.step(1 / 20); G.setIntent(w, p, { action: G.IntentAction.None }); };

describe("ADR-262: the beginning torch boils water and cooks meat", () => {
  it("boils with a held torch; no fire and no torch still fails NoFire; a lantern does not count", () => {
    const w = makeWorld(); const p = mk(w, 1); G.addItem(w, p, id("water_flask"), 1); hold(w, p, "torch");
    expect(G.holdingTorch(w, p)).toBe(true);
    boil(w, p);
    expect(G.slotItem(w, p, 0).item).toBe(id("boiled_water_flask"));
    expect(w.getArray(p, G.Inventory, "durability")![0]).toBe(4);
    const q = mk(w, 2, 30, 0); G.addItem(w, q, id("canteen"), 1);
    const fails = collect(w, G.ConsumeFailed);
    boil(w, q);
    expect(G.slotItem(w, q, 0).item).toBe(id("canteen"));
    expect(fails.at(-1)!.reason).toBe(G.ConsumeFail.NoFire);
    if (d.items.has(id("lantern"))) { hold(w, q, "lantern"); expect(G.holdingTorch(w, q)).toBe(false); boil(w, q); expect(G.slotItem(w, q, 0).item).toBe(id("canteen")); }
  });

  it("cooked meat queues and crafts with a held torch away from a campfire; bread still needs a campfire", () => {
    const w = makeWorld(); const p = mk(w, 1); G.addItem(w, p, id("raw_meat"), 2);
    const meat = d.recipeId("cooked_meat"); const bread = d.recipeId("bread");
    expect(G.craftQueueReason(w, p, meat, 1)).toMatch(/no_station|skill_locked/);
    hold(w, p, "torch");
    expect(G.craftQueueReason(w, p, bread, 1)).toMatch(/no_station|skill_locked/);
    G.setUnlockProvider(w, () => true); expect(G.craftQueueReason(w, p, bread, 1)).toBe("no_station"); G.setUnlockProvider(w, undefined);
    expect(G.enqueueCraft(w, p, meat, 1)).toBe(0);
    steps(w, 200);
    expect(G.countItem(w, p, id("cooked_meat"))).toBe(1);
    expect(G.countItem(w, p, id("torch"))).toBe(1); // the torch is not consumed
    expect(G.holdingTorch(w, p)).toBe(true);
  });

  it("cooked meat still works at a lit campfire without a torch", () => {
    const w = makeWorld(); const p = mk(w, 1); G.addItem(w, p, id("raw_meat"), 1);
    G.setUnlockProvider(w, () => true); G.spawnStation(w, G.StationKind.Campfire, 1, 0, { burnSeconds: 600 });
    expect(G.enqueueCraft(w, p, d.recipeId("cooked_meat"), 1)).toBe(0);
    steps(w, 200);
    expect(G.countItem(w, p, id("cooked_meat"))).toBe(1);
  });
});
