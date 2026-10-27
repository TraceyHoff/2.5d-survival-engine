// ADR-204: server-authoritative split stack / move slot (hotbar).
import { describe, it, expect } from "vitest";
import { applySnapshot, CommandRegistry, CommandRejected, decodeSnapshot, encodeSnapshot, installCommandHandlers } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k);
const slots = (w: ReturnType<typeof makeWorld>, p: number) => G.readSlots(w, p as never);
function setup() {
  const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
  const reg = G.registerGameplayCommands(new CommandRegistry()); const h = installCommandHandlers(w, reg); G.installInventoryOpCommands(w, h);
  const rej: string[] = []; w.events.on(CommandRejected, (e) => rej.push(e.reason));
  const run = (def: typeof G.SplitStackCmd | typeof G.MoveSlotCmd, v: Record<string, number>): void => { h.enqueue(p, 1, 1, reg.make(def as never, v as never)); w.step(1 / 20); };
  return { w, p, run, rej };
}
describe("ADR-204 split stack", () => {
  it("splits N into the first empty slot; totals, weight and freshness unchanged", () => {
    const { w, p, run, rej } = setup(); G.addItem(w, p, id("wood"), 10); const before = slots(w, p); const wt = w.getField(p, G.Inventory, "weight");
    run(G.SplitStackCmd, { where: 0, slot: 0, count: 4 }); const v = slots(w, p);
    expect(rej).toEqual([]); expect([v.item(0), v.count(0), v.item(1), v.count(1)]).toEqual([id("wood"), 6, id("wood"), 4]);
    expect(v.created(1)).toBe(before.created(0)); expect(G.countItem(w, p, id("wood"))).toBe(10); expect(w.getField(p, G.Inventory, "weight")).toBe(wt);
  });
  it("rejects bad quantities, slot bounds and full inventories without writing", () => {
    const { w, p, run, rej } = setup(); G.addItem(w, p, id("wood"), 10); G.addItem(w, p, id("stone_axe"), 1);
    for (const count of [0, 10, 11, 65535]) run(G.SplitStackCmd, { where: 0, slot: 0, count });
    run(G.SplitStackCmd, { where: 0, slot: 1, count: 1 }); // single item
    run(G.SplitStackCmd, { where: 0, slot: 200, count: 1 }); run(G.SplitStackCmd, { where: 0, slot: 16, count: 1 });
    run(G.SplitStackCmd, { where: 1, slot: 0, count: 2 }); run(G.SplitStackCmd, { where: 7, slot: 0, count: 2 }); // no open container / bad holder
    expect(rej).toEqual(["bad_count", "bad_count", "bad_count", "bad_count", "bad_count", "bad_slot", "bad_slot", "bad_holder", "bad_holder"]);
    expect(slots(w, p).count(0)).toBe(10);
    const full = new G.ScratchSlots(2, 0, [id("wood"), id("stone")], [5, 5], [0, 0]); expect(G.checkSplit(full, 0, 2)).toEqual({ fail: "no_space" });
  });
  it("container cap: slots >= 96 are always out of bounds", () => {
    const n = 120; const v = new G.ScratchSlots(n, 0, Array.from({ length: n }, (_, i) => (i === 96 || i === 95 ? id("wood") : 0)), Array.from({ length: n }, (_, i) => (i === 96 || i === 95 ? 9 : 0)), []);
    expect(G.checkSplit(v, 96, 2)).toEqual({ fail: "bad_slot" }); expect("to" in G.checkSplit(v, 95, 2)).toBe(true);
    expect(G.checkMove(v, 95, 96)).toBe("bad_slot"); expect(G.CONTAINER_MAX_SLOTS).toBe(96);
  });
  it("defaultSplit is half (at least 1)", () => { expect([G.defaultSplit(10), G.defaultSplit(7), G.defaultSplit(2)]).toEqual([5, 3, 1]); });
});
describe("ADR-204 move slot (to hotbar)", () => {
  it("moves into an empty hotbar slot and swaps when occupied; equipped main hand follows its item", () => {
    const { w, p, run, rej } = setup(); G.addItem(w, p, id("wood"), 10); G.addItem(w, p, id("stone"), 4); G.addItem(w, p, id("fiber"), 4); G.addItem(w, p, id("stone_axe"), 1);
    const axeSlot = 3; expect(slots(w, p).item(axeSlot)).toBe(id("stone_axe"));
    w.set(p, G.Equipment, { mainHandSlot: axeSlot, mainHandItem: id("stone_axe") });
    run(G.MoveSlotCmd, { where: 0, slot: axeSlot, to: 1 }); const v = slots(w, p);
    expect(rej).toEqual([]); expect(v.item(1)).toBe(id("stone_axe")); expect(v.item(axeSlot)).toBe(id("stone")); expect(v.count(axeSlot)).toBe(4);
    expect(w.getField(p, G.Equipment, "mainHandSlot")).toBe(1);
    run(G.MoveSlotCmd, { where: 0, slot: 1, to: 12 }); expect(slots(w, p).item(12)).toBe(id("stone_axe")); expect(slots(w, p).item(1)).toBe(0); expect(w.getField(p, G.Equipment, "mainHandSlot")).toBe(12);
  });
  it("rejects same slot, empty source and out-of-range slots", () => {
    const { w, p, run, rej } = setup(); G.addItem(w, p, id("wood"), 3);
    run(G.MoveSlotCmd, { where: 0, slot: 0, to: 0 }); run(G.MoveSlotCmd, { where: 0, slot: 5, to: 1 }); run(G.MoveSlotCmd, { where: 0, slot: 0, to: 16 }); run(G.MoveSlotCmd, { where: 0, slot: 255, to: 1 });
    expect(rej).toEqual(["same_slot", "bad_count", "bad_slot", "bad_slot"]); expect(slots(w, p).count(0)).toBe(3);
  });
  it("re-arranged inventory survives a persistence snapshot round trip", () => {
    const { w, p, run } = setup(); G.addItem(w, p, id("wood"), 10); run(G.SplitStackCmd, { where: 0, slot: 0, count: 3 }); run(G.MoveSlotCmd, { where: 0, slot: 1, to: 7 });
    const w2 = makeWorld(); const p2 = G.spawnPlayer(w2, { x: 0, y: 0, maxWeight: 0 }); applySnapshot(w2, decodeSnapshot(w2, encodeSnapshot(w, { all: true })));
    const v = slots(w2, p2); expect([v.count(0), v.item(7), v.count(7)]).toEqual([7, id("wood"), 3]);
  });
});
