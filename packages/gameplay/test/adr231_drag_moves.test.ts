// ADR-231: drag-and-drop moves are server-validated — dropping a stack on the same item merges (rest stays), a different
// item swaps; ContainerToSlot dir 1 = pack slot -> container slot (empty or swap / merge).
import { describe, it, expect } from "vitest";
import { CommandRegistry, CommandRejected, installCommandHandlers, Transform } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k);
function setup() {
  const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
  const crate = w.create(); w.add(crate, Transform, { x: 0.5, y: 0 }).add(crate, G.Container, { slotCount: 6 }).add(crate, G.ContainerViewers);
  w.add(p, G.Viewing, { container: crate });
  const reg = G.registerGameplayCommands(new CommandRegistry()); const h = installCommandHandlers(w, reg); G.installInventoryOpCommands(w, h);
  const rej: string[] = []; w.events.on(CommandRejected, (e) => rej.push(e.reason));
  const run = (def: G.InventoryOpDef, v: Record<string, number>): void => { h.enqueue(p, 1, 1, reg.make(def as never, v as never)); w.step(1 / 20); };
  return { w, p, crate, run, rej, pack: () => G.readSlots(w, p), box: () => G.readSlots(w, crate) };
}
const filled = (v: G.SlotView): number[] => { const o: number[] = []; for (let i = 0; i < v.slotCount; i++) if (v.item(i)) o.push(i); return o; };

describe("ADR-231 drag moves", () => {
  it("pack: dropping a stack on the same item merges; overflow stays in the source slot", () => {
    const { w, p, run, rej, pack } = setup(); const wood = id("wood"); const max = d.items.get(wood)!.maxStack;
    G.addItem(w, p, wood, max); run(G.SplitStackCmd, { where: 0, slot: 0, count: 3 }); expect(rej).toEqual([]);
    const [a, b] = filled(pack()); expect([pack().count(a!), pack().count(b!)]).toEqual([max - 3, 3]);
    run(G.MoveSlotCmd, { where: 0, slot: b!, to: a! }); expect(rej).toEqual([]);
    expect(filled(pack())).toEqual([a]); expect(pack().count(a!)).toBe(max);
    G.addItem(w, p, wood, 5); run(G.SplitStackCmd, { where: 0, slot: a!, count: 2 }); // a = max-2, b = 5, c = 2
    const [, b2] = filled(pack()); run(G.MoveSlotCmd, { where: 0, slot: b2!, to: a! }); expect(rej).toEqual([]);
    expect(pack().count(a!)).toBe(max); expect(pack().count(b2!)).toBe(3); expect(G.countItem(w, p, wood)).toBe(max + 5);
  });
  it("different items swap (unchanged ADR-127 behaviour)", () => {
    const { w, p, run, pack } = setup(); G.addItem(w, p, id("wood"), 4); G.addItem(w, p, id("stone"), 2);
    run(G.MoveSlotCmd, { where: 0, slot: 0, to: 1 }); expect([pack().item(0), pack().item(1)]).toEqual([id("stone"), id("wood")]);
  });
  it("ContainerToSlot dir 1: pack slot -> empty container slot, swap, and merge", () => {
    const { w, p, crate, run, rej, pack, box } = setup(); G.addItem(w, p, id("stone_axe"), 1); G.addItem(w, p, id("wood"), 3);
    run(G.ContainerToSlotCmd, { slot: 4, to: 0, dir: 1 }); expect(rej).toEqual([]);
    expect(box().item(4)).toBe(id("stone_axe")); expect(pack().item(0)).toBe(0);
    G.addItem(w, crate, id("wood"), 4); const wb = filled(box()).find((s) => box().item(s) === id("wood"))!;
    run(G.ContainerToSlotCmd, { slot: wb, to: 1, dir: 1 }); expect(rej).toEqual([]);
    expect(box().count(wb)).toBe(7); expect(pack().item(1)).toBe(0);
    G.addItem(w, p, id("stone"), 2); const st = filled(pack())[0]!;
    run(G.ContainerToSlotCmd, { slot: 4, to: st, dir: 1 }); expect(rej).toEqual([]);
    expect([box().item(4), pack().item(st)]).toEqual([id("stone"), id("stone_axe")]);
  });
  it("ContainerToSlot dir 0 merges a storage stack into a matching pack stack; empty source rejects", () => {
    const { w, p, crate, run, rej, pack, box } = setup(); G.addItem(w, p, id("wood"), 3); G.addItem(w, crate, id("wood"), 4);
    run(G.ContainerToSlotCmd, { slot: 0, to: 0 }); expect(rej).toEqual([]); expect(pack().count(0)).toBe(7); expect(box().item(0)).toBe(0);
    run(G.ContainerToSlotCmd, { slot: 0, to: 2 }); expect(rej.length).toBe(1); expect(pack().count(0)).toBe(7);
    run(G.ContainerToSlotCmd, { slot: 5, to: 5, dir: 1 }); expect(rej.length).toBe(2);
  });
});
