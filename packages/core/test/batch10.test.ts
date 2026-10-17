import { describe, it, expect } from "vitest";
import { World, defineComponent, installContainers, arrayFieldsContainer, scalarFieldsContainer, transfer, transaction, defaultMergeMeta, Transform } from "../src/index.js";

const N = 4;
const Inv = defineComponent("Inv10", { items: { type: "u16", length: N }, counts: { type: "u16", length: N }, createdTick: { type: "u32", length: N }, durability: { type: "u16", length: N } });
function setup(opts?: Parameters<typeof installContainers>[2], max?: Parameters<typeof installContainers>[1]) {
  const w = new World(); w.register(Inv); const C = installContainers(w, max, opts);
  C.register(Inv, arrayFieldsContainer(Inv, { item: "items", count: "counts", createdTick: "createdTick", durability: "durability" }));
  const a = w.create(), b = w.create(); w.add(a, Inv); w.add(b, Inv); return { w, C, a, b };
}
const slot = (w: World, e: number, i: number) => { const v = w.get(e, Inv)!; return { item: v.items[i], count: v.counts[i], createdTick: v.createdTick[i], durability: v.durability[i] }; };

describe("slot durability / createdTick", () => {
  it("transfer carries state; merge uses weighted createdTick; swap moves whole slots", () => {
    const { w, a, b } = setup();
    transaction(w, (tx) => { tx.add(a, 1, 10, { createdTick: 100 }); return tx.add(b, 1, 30, { createdTick: 200 }); });
    expect(slot(w, a, 0)).toEqual({ item: 1, count: 10, createdTick: 100, durability: 0 });
    expect(transfer(w, a, 0, b, 0, 10)).toEqual({ ok: true }); expect(slot(w, b, 0)).toMatchObject({ count: 40, createdTick: 175 });
    expect(transfer(w, b, 0, a, 2, 5)).toEqual({ ok: true }); expect(slot(w, a, 2)).toMatchObject({ count: 5, createdTick: 175 });
    transaction(w, (tx) => tx.add(a, 7, 1, { durability: 80, createdTick: 3 }));
    expect(transfer(w, a, 0, b, 0, 1)).toEqual({ ok: true }); // swap of axe with stack
    expect(slot(w, b, 0)).toEqual({ item: 7, count: 1, createdTick: 3, durability: 80 }); expect(slot(w, a, 0)).toMatchObject({ item: 1, count: 35, createdTick: 175 });
  });
  it("durability items are non-stackable by default (also with a custom maxStack) and add() picks empty slots", () => {
    const { w, a, b } = setup({}, () => 50);
    expect(transaction(w, (tx) => tx.add(a, 7, 2, { durability: 90 }))).toEqual({ ok: true });
    expect([slot(w, a, 0).count, slot(w, a, 1).count]).toEqual([1, 1]);
    transaction(w, (tx) => tx.add(b, 7, 1, { durability: 40 }));
    expect(transfer(w, a, 0, b, 0, 1)).toEqual({ ok: true }); expect(slot(w, b, 0).durability).toBe(90); expect(slot(w, a, 0).durability).toBe(40); // swapped, never merged
  });
  it("transaction add/remove/set and rollback restore durability + createdTick", () => {
    const { w, a } = setup();
    transaction(w, (tx) => { tx.add(a, 2, 5, { createdTick: 10 }); return tx.add(a, 7, 1, { durability: 33, createdTick: 4 }); });
    const before = JSON.stringify(w.get(a, Inv));
    const r = transaction(w, (tx) => { tx.remove(a, 2, 5); tx.set(a, 3, { item: 9, count: 1, meta: 0, durability: 5, createdTick: 77 }); return { ok: false, reason: "nope" }; });
    expect(r.ok).toBe(false); expect(JSON.stringify(w.get(a, Inv))).toBe(before);
    transaction(w, (tx) => tx.remove(a, 2, 2)); expect(slot(w, a, 0)).toMatchObject({ count: 3, createdTick: 10 });
    transaction(w, (tx) => tx.add(a, 2, 1, { createdTick: 50 })); expect(slot(w, a, 0)).toMatchObject({ count: 4, createdTick: 20 });
  });
  it("mergeMeta hook and default helper; scalar adapter mappings; isRegistered", () => {
    expect(defaultMergeMeta({ item: 1, count: 2, meta: 0, durability: 50, createdTick: 0 }, 2, { durability: 20, createdTick: 30 }, 1)).toEqual({ meta: 0, createdTick: 10, durability: 20 });
    const { w, a, b } = setup({ mergeMeta: (s) => ({ meta: s.meta, createdTick: 999 }) });
    transaction(w, (tx) => { tx.add(a, 1, 1, { createdTick: 1 }); return tx.add(b, 1, 1, { createdTick: 2 }); });
    transfer(w, a, 0, b, 0, 1); expect(slot(w, b, 0).createdTick).toBe(999);
    const S = defineComponent("S10", { i0: "u16", c0: "u16", d0: "u16", t0: "u32" }); const w2 = new World(); expect(w2.isRegistered(S)).toBe(false); w2.register(S); expect(w2.isRegistered(S)).toBe(true); expect(w2.isRegistered(Transform)).toBe(true);
    const ad = scalarFieldsContainer(S, { items: ["i0"], counts: ["c0"], durabilities: ["d0"], createdTicks: ["t0"] }); const e = w2.create(); w2.add(e, S);
    ad.setSlot(w2, e, 0, { item: 4, count: 1, meta: 0, durability: 12, createdTick: 34 }); expect(ad.getSlot(w2, e, 0)).toEqual({ item: 4, count: 1, meta: 0, durability: 12, createdTick: 34 });
  });
});
