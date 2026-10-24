// ADR-104: ComponentStore tracks a dirty word range so clearChanged / changedIndices skip untouched words.
import { describe, expect, test } from "vitest";
import { World, defineComponent } from "../src/index.js";

const Pos = defineComponent("DirtyPos", { x: "f32" }, { networked: true });
describe("ComponentStore dirty range", () => {
  test("changedIndices sees exactly the written entities across ticks; clearChanged resets", () => {
    const w = new World(); w.register(Pos);
    const es = Array.from({ length: 300 }, () => { const e = w.create(); w.add(e, Pos, { x: 0 }); return e; });
    const st = w.store(Pos);
    st.clearChanged(); expect([...st.changedIndices()]).toEqual([]);
    w.set(es[250]!, Pos, { x: 1 }); w.set(es[3]!, Pos, { x: 2 }); w.set(es[70]!, Pos, { x: 3 });
    const got = [...st.changedIndices()].sort((a, b) => a - b);
    expect(got).toEqual([es[3]!, es[70]!, es[250]!].map((e) => e & 0xfffff).sort((a, b) => a - b));
    st.clearChanged(); expect([...st.changedIndices()]).toEqual([]);
    w.set(es[100]!, Pos, { x: 4 }); expect([...st.changedIndices()]).toHaveLength(1);
  });
});
