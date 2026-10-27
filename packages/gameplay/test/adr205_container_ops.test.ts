// ADR-205: split / move inside an open container and container slot -> pack hotbar slot (swap back), server-validated.
import { describe, it, expect } from "vitest";
import { CommandRegistry, CommandRejected, installCommandHandlers, Transform } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k);
function setup(open = true) {
  const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
  const crate = w.create(); w.add(crate, Transform, { x: 0.5, y: 0 }).add(crate, G.Container, { slotCount: 6 }).add(crate, G.ContainerViewers);
  if (open) w.add(p, G.Viewing, { container: crate });
  const reg = G.registerGameplayCommands(new CommandRegistry()); const h = installCommandHandlers(w, reg); G.installInventoryOpCommands(w, h);
  const rej: string[] = []; w.events.on(CommandRejected, (e) => rej.push(e.reason));
  const run = (def: G.InventoryOpDef, v: Record<string, number>): void => { h.enqueue(p, 1, 1, reg.make(def as never, v as never)); w.step(1 / 20); };
  return { w, p, crate, run, rej, pack: () => G.readSlots(w, p), box: () => G.readSlots(w, crate) };
}
describe("ADR-205 container -> hotbar", () => {
  it("moves a storage stack into an empty hotbar slot", () => {
    const { w, crate, run, rej, pack, box } = setup(); G.addItem(w, crate, id("stone_axe"), 1);
    run(G.ContainerToSlotCmd, { slot: 0, to: 3 });
    expect(rej).toEqual([]); expect(pack().item(3)).toBe(id("stone_axe")); expect(box().item(0)).toBe(0);
  });
  it("swaps an occupied hotbar slot back into the container (durability / crafter kept)", () => {
    const { w, p, crate, run, rej, pack, box } = setup(); G.addItem(w, p, id("wood"), 7); G.addItem(w, crate, id("stone_axe"), 1);
    const dur = box().durability(0);
    run(G.ContainerToSlotCmd, { slot: 0, to: 0 });
    expect(rej).toEqual([]); expect([pack().item(0), pack().durability(0)]).toEqual([id("stone_axe"), dur]); expect([box().item(0), box().count(0)]).toEqual([id("wood"), 7]);
    expect(G.countItem(w, p, id("wood"))).toBe(0);
  });
  it("rejects: closed container, empty / out-of-range slots, equipped target, overweight — nothing written", () => {
    const s = setup(false); G.addItem(s.w, s.crate, id("wood"), 3); s.run(G.ContainerToSlotCmd, { slot: 0, to: 0 }); expect(s.rej).toEqual(["no_container"]);
    const { w, p, crate, run, rej, pack, box } = setup(); G.addItem(w, crate, id("wood"), 3); G.addItem(w, p, id("stone_axe"), 1);
    run(G.ContainerToSlotCmd, { slot: 4, to: 1 }); run(G.ContainerToSlotCmd, { slot: 6, to: 1 }); run(G.ContainerToSlotCmd, { slot: 0, to: 16 }); run(G.ContainerToSlotCmd, { slot: 200, to: 1 });
    w.set(p, G.Equipment, { mainHandSlot: 0, mainHandItem: id("stone_axe") }); run(G.ContainerToSlotCmd, { slot: 0, to: 0 });
    const wt = d.items.get(id("wood"))!.weight; w.setField(p, G.Inventory, "maxWeight", d.items.get(id("stone_axe"))!.weight + wt * 2);
    run(G.ContainerToSlotCmd, { slot: 0, to: 2 }); // 3 wood would exceed the pack cap
    expect(rej).toEqual(["empty_slot", "bad_slot", "bad_slot", "bad_slot", "equipped", "too_heavy"]);
    expect([box().count(0), pack().item(0), pack().item(2)]).toEqual([3, id("stone_axe"), 0]);
  });
  it("split and move work inside the open container (where = 1)", () => {
    const { w, crate, run, rej, box } = setup(); G.addItem(w, crate, id("wood"), 9);
    run(G.SplitStackCmd, { where: 1, slot: 0, count: 4 }); run(G.MoveSlotCmd, { where: 1, slot: 1, to: 5 });
    expect(rej).toEqual([]); expect([box().count(0), box().item(1), box().count(5)]).toEqual([5, 0, 4]);
  });
  it("every reason the ops can return has friendly text", () => {
    for (const r of ["bad_holder", "no_container", "bad_slot", "bad_count", "empty_slot", "no_space", "same_slot", "too_heavy", "equipped"] as const) expect(G.INVENTORY_OP_REJECT_TEXT[r]).toMatch(/\w/);
  });
});
