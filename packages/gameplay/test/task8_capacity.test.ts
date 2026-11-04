import { describe, expect, it } from "vitest";
import { installPermissions, PlayerId, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const WOOD = d.itemId("wood");
const mk = (w: World, id: number, x = 0, y = 0) => { const p = G.spawnPlayer(w, { x, y, clientId: id }); w.add(p, PlayerId, { id }); return p; };

describe("holding capacity", () => {
  it("pack capacity: weight, slots used, free weight and free slots, from contents", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10);
    G.addItem(w, me, WOOD, 5);
    const cv = G.capacityView({ world: w, player: me }, me)!;
    expect(cv.slotCount).toBeGreaterThan(0); expect(cv.slotsUsed).toBe(1); expect(cv.freeSlots).toBe(cv.slotCount - 1);
    const woodW = d.items.get(WOOD)!.weight; expect(cv.weight).toBeCloseTo(woodW * 5, 6);
    expect(cv.freeWeight).toBeCloseTo(cv.maxWeight - cv.weight, 6); expect(cv.pct).toBeCloseTo(cv.weight / cv.maxWeight, 6);
    expect(G.capacityText(cv)).toContain("slots");
  });
  it("container capacity: a storage chest reports its own slots and weight, not the player's", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10);
    const sn = G.snapPlacement(w, { piece: d.pieceId("basic_storage_box"), x: 11, y: 10, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
    const chest = G.placePiece(w, me, sn, { pay: false });
    G.setIntent(w, me, { action: G.IntentAction.OpenContainer, target: chest }); steps(w, 1);
    const box = w.getField(me, G.Viewing, "container")!;
    G.addItem(w, box, WOOD, 2);
    const cv = G.capacityView({ world: w, player: me }, box)!;
    expect(cv.slotsUsed).toBe(1); expect(cv.weight).toBeCloseTo(d.items.get(WOOD)!.weight * 2, 6);
    expect(cv.slotCount).toBeGreaterThan(0);
  });
  it("capacityView returns undefined for an entity with no inventory", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10);
    const other = mk(w, 2, 20, 20);
    // a fresh entity has neither Inventory nor Container, so capacity is undefined
    const ghost = w.create(); expect(G.capacityView({ world: w, player: me }, ghost)).toBeUndefined();
    expect(other).toBeDefined();
  });
});
