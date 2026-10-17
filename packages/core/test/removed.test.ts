import { describe, it, expect } from "vitest";
import { World, defineComponent, entityIndex } from "../src/index.js";
const C = defineComponent("C", { v: "u8" });
const mk = () => { const w = new World(); w.register(C); return w; };

describe("removal tracking", () => {
  it("records world.remove and despawn with original generation", () => {
    const w = mk(); const a = w.create(), b = w.create(), c = w.create();
    for (const e of [a, b, c]) w.add(e, C); w.step(0.05);
    w.remove(a, C); w.destroy(b);
    const b2 = w.create(); expect(entityIndex(b2)).toBe(entityIndex(b));
    expect([...w.removed(C)]).toEqual([a, b]);
    expect(w.isAlive([...w.removed(C)][1]!)).toBe(false);
  });
  it("re-add same tick appears in both removed and changed", () => {
    const w = mk(); const e = w.create(); w.add(e, C); w.step(0.05);
    w.remove(e, C); w.add(e, C, { v: 2 });
    expect([...w.removed(C)]).toEqual([e]); expect([...w.changed(C)]).toEqual([e]);
    w.remove(e, C); expect([...w.removed(C)]).toEqual([e]); // deduped
  });
  it("removing absent component records nothing", () => {
    const w = mk(); const e = w.create(); w.remove(e, C); w.destroy(e);
    expect([...w.removed(C)]).toEqual([]);
  });
  it("cleared by clearChanges and end of step, untouched by simulate", () => {
    const w = mk(); const e = w.create(); w.add(e, C);
    w.addSystem("simulation", "noop", () => {});
    w.remove(e, C); w.simulate(3, 0.05);
    expect([...w.removed(C)]).toEqual([e]);
    w.step(0.05); expect([...w.removed(C)]).toEqual([]);
    w.add(e, C); w.remove(e, C); w.clearChanges(); expect([...w.removed(C)]).toEqual([]);
  });
  it("records removals made by systems during step, visible to later phases", () => {
    const w = mk(); const e = w.create(); w.add(e, C); let seen: number[] = [];
    w.addSystem("simulation", "rm", (wd) => wd.remove(e, C));
    w.addSystem("network", "obs", (wd) => { seen = [...wd.removed(C)]; });
    w.step(0.05); expect(seen).toEqual([e]); expect([...w.removed(C)]).toEqual([]);
  });
});
