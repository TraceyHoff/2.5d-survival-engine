import { describe, it, expect } from "vitest";
import { World, Transform, Rng, type Entity } from "@engine/core";
import { ChunkMembership, InterestGrid } from "../src/index.js";

/** ADR-212 leak/regression: incremental interest (change log) must equal a full rebuild, and per-tick state stays bounded. */
describe("InterestGrid incremental path [ADR-212]", () => {
  it("matches the full-rebuild result under churn (moves across chunks, spawns, despawns, viewer moves)", () => {
    const w = new World({ maxEntities: 4000 }); const m = new ChunkMembership(w); const g = new InterestGrid(m, { radius: 1, hysteresis: 1 });
    w.addSystem("postSim", "m", () => m.update());
    const rng = new Rng(7); const ents: Entity[] = []; const W = 32 * 8;
    const spawn = (): void => { const e = w.create(); w.add(e, Transform, { x: rng.next() * W, y: rng.next() * W }); ents.push(e); };
    for (let i = 0; i < 400; i++) spawn();
    let vx = 100, vy = 100; const mirror = new Set<Entity>();
    for (let t = 0; t < 600; t++) {
      for (let k = 0; k < 30; k++) { const e = ents[(rng.next() * ents.length) | 0]!; if (!w.isAlive(e)) continue; w.setField(e, Transform, "x", Math.max(0, Math.min(W - 1, w.getField(e, Transform, "x")! + (rng.next() - 0.5) * 40))); }
      if (t % 7 === 0) spawn();
      if (t % 11 === 0) { const i = (rng.next() * ents.length) | 0; const e = ents[i]!; if (w.isAlive(e)) w.destroy(e); }
      if (t % 50 === 0) { vx = rng.next() * W; vy = rng.next() * W; }
      w.step(0.05); g.setClient(1, vx, vy); g.setAlwaysRelevant(1, [w.environment]); g.update();
      const s = g.get(1)!;
      const want = new Set<Entity>([w.environment]); for (const c of s.chunks) for (const e of m.entitiesIn(c)) want.add(e);
      expect(new Set(s.entities)).toEqual(want);
      for (const e of s.left) { expect(mirror.has(e)).toBe(true); mirror.delete(e); }
      for (const e of s.entered) { expect(mirror.has(e)).toBe(false); mirror.add(e); }
      expect(mirror).toEqual(want);
    }
    // bounded: the change log is trimmed every update
    expect((m as unknown as { logE: unknown[] }).logE.length).toBe(0);
  });
});
