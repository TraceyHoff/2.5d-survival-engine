import { describe, it, expect } from "vitest";
import { World, Transform, Rng } from "@engine/core";
import { ChunkMembership, InterestGrid, chunkKey } from "../src/index.js";

describe("InterestGrid", () => {
  it("enter/leave sets with hysteresis and always-relevant entities", () => {
    const w = new World(); const m = new ChunkMembership(w); const g = new InterestGrid(m, { radius: 1, hysteresis: 1 });
    const near = w.create(); w.add(near, Transform, { x: 40, y: 10 });
    const far = w.create(); w.add(far, Transform, { x: 32 * 3 + 1, y: 10 });
    m.update(); g.setClient(1, 10, 10); g.setAlwaysRelevant(1, [w.environment]); g.update();
    let i = g.get(1)!; expect(new Set(i.entered)).toEqual(new Set([near, w.environment])); expect(i.chunks.size).toBe(9);
    g.setClient(1, 32 * 2 + 10, 10); g.update(); i = g.get(1)!;
    expect(i.entered).toEqual([far]); expect(i.left).toEqual([]); expect(i.leftChunks.length).toBe(3); expect(i.chunks.has(chunkKey(0, 0))).toBe(true); // hysteresis keeps chunk 0 (distance 2)
    g.setClient(1, 32 * 4 + 10, 10); g.update(); i = g.get(1)!;
    expect(i.left).toEqual([near]); expect(i.leftChunks).toContain(chunkKey(0, 0));
    g.update(); expect(g.get(1)!.entered).toEqual([]); expect(g.get(1)!.left).toEqual([]);
  });
  it("benchmark: 200 players, 50k entities", () => {
    const w = new World({ maxEntities: 60000 }); const m = new ChunkMembership(w); const g = new InterestGrid(m, { radius: 2, hysteresis: 1 });
    const rng = new Rng(1); const SIZE = 64 * 32; // 64x64 chunks
    for (let i = 0; i < 50000; i++) w.add(w.create(), Transform, { x: rng.range(0, SIZE), y: rng.range(0, SIZE) });
    let t = performance.now(); m.update(); const tMember = performance.now() - t;
    const players = Array.from({ length: 200 }, () => ({ x: rng.range(0, SIZE), y: rng.range(0, SIZE) }));
    players.forEach((p, i) => g.setClient(i, p.x, p.y));
    t = performance.now(); g.update(); const tFirst = performance.now() - t;
    const N = 20; let total = 0, rel = 0;
    for (let k = 0; k < N; k++) {
      players.forEach((p, i) => { p.x += 0.2; g.setClient(i, p.x, p.y); });
      // move 5% of entities each tick
      const st = w.store(Transform); for (let j = 0; j < 2500; j++) { const s = rng.int(0, st.size); st.data.x[s] = (st.data.x[s]! + 0.5) % SIZE; st.markChanged(st.dense[s]! & 0xfffff); }
      t = performance.now(); m.update(); g.update(); total += performance.now() - t; w.clearChanges();
    }
    for (const i of g.clientIds()) rel += g.get(i)!.entities.size;
    console.log(`[bench] interest: membership build 50k=${tMember.toFixed(1)}ms, first update 200 players=${tFirst.toFixed(1)}ms, steady tick (membership 2.5k moves + interest)=${(total / N).toFixed(2)}ms, avg relevant/player=${(rel / 200).toFixed(0)}`);
    expect(total / N).toBeLessThan(100);
  });
});
