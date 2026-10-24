import { describe, expect, it } from "vitest";
import { NetId, Transform, World } from "@engine/core";
import { BitWriter, captureState, encodeDelta, NetSchema } from "@engine/net";
import * as G from "@engine/gameplay";

/** ADR-098: a 96-slot Container replicates only the slots that changed (element-level delta), never the whole array. */
describe("96-slot Container replication bandwidth", () => {
  it("changing one slot of a full 96-slot container costs a few bytes, not the array", () => {
    const w = new World(); G.installGameplay(w); const schema = new NetSchema(w);
    const e = w.create(); const N = G.CONTAINER_MAX_SLOTS;
    const fill = Array.from({ length: N }, (_, i) => i + 1);
    w.add(e, NetId, { id: 7 }).add(e, Transform, { x: 1, y: 1 })
      .add(e, G.Container, { slotCount: N, maxWeight: 10000, items: fill, counts: fill, createdTick: fill, durability: fill, crafterId: fill } as never);
    const s0 = captureState(w, schema, undefined); w.clearChanges();
    const full = new BitWriter(); encodeDelta(full, schema, s0, undefined); const spawnBytes = full.finish().length;

    // move one stack's count in slot 63 (deposit/withdraw/split all write single slots)
    const st = w.store(G.Container); const slot = st.slot(e & 0xfffff);
    st.data.counts[slot * N + 63] = 500; st.markChanged(e & 0xfffff);
    const s1 = captureState(w, schema, s0); w.clearChanges();
    const d1 = new BitWriter(); const stats = encodeDelta(d1, schema, s1, s0); const deltaBytes = d1.finish().length;
    expect(stats.changes).toBe(1);
    // whole-array cost is ~96 x (2+2+4+2+4) = 1344 B; one slot must be tiny
    expect(spawnBytes).toBeGreaterThan(N * 14);
    expect(deltaBytes).toBeLessThanOrEqual(24); // mostly the per-record component masks

    // a full stack move (item+count+tick+durability+crafter in 2 slots) is still well under 5% of the array
    for (const f of ["items", "counts", "createdTick", "durability", "crafterId"] as const) { st.data[f][slot * N + 10] = 0; st.data[f][slot * N + 95] = 3; }
    st.markChanged(e & 0xfffff);
    const s2 = captureState(w, schema, s1); const d2 = new BitWriter(); encodeDelta(d2, schema, s2, s1);
    expect(d2.finish().length).toBeLessThan(N * 14 * 0.05);
    console.log(`[container96] spawn ${spawnBytes} B, 1-slot change ${deltaBytes} B`);
  });
});
