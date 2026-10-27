import { describe, it, expect } from "vitest";
import { CorrectionSampler, type CorrectionSource } from "../src/correction-sampler.js";

// Simulates the 20 Hz sim + 60 fps render: a reconciliation pulls the sim back 0.5 tiles; NetClient decays the offset.
describe("ADR-208 reconciliation offset is rendered smoothly", () => {
  const run = (useOffset: boolean): number[] => {
    let off: number | undefined; const src: CorrectionSource = { correctionInto: (_e, o) => { if (off === undefined) return false; o.x = off; o.y = 0; o.z = 0; return true; } };
    const cs = new CorrectionSampler(); const xs: number[] = []; let simPrev = 0, sim = 0;
    for (let tick = 1; tick <= 20; tick++) {
      simPrev = sim; sim += 0.2; // walking 4 tiles/s
      if (tick === 8) { sim -= 0.5; off = 0.5; } else if (off !== undefined) { off *= Math.exp(-0.05 / 0.1); if (off < 1e-3) off = undefined; }
      for (let f = 1; f <= 3; f++) { const a = f / 3; const cur = { x: sim, y: 0, z: 0 }, sc = { x: 0, y: 0, z: 0 }; let prev = { x: simPrev, y: 0, z: 0 };
        if (useOffset) prev = cs.apply(src, 1, tick, cur, prev, sc); xs.push(prev.x + (cur.x - prev.x) * a); }
    }
    return xs;
  };
  const maxBack = (xs: number[]): number => Math.max(0, ...xs.slice(1).map((x, i) => xs[i]! - x));
  it("without the offset the player pops back by the full correction; with it, never moves backwards", () => {
    expect(maxBack(run(false))).toBeGreaterThan(0.05) // sim rubber-bands backwards 0.3 tiles over one tick;
    expect(maxBack(run(true))).toBe(0);
    const xs = run(true), steps = xs.slice(1).map((x, i) => x - xs[i]!);
    expect(Math.max(...steps)).toBeLessThan(0.0667 + 1e-6); // never faster than the walk itself (0.2 / 3 frames): no lurch
  });
  it("is a no-op with no correction and frees its slot after decay", () => {
    const cs = new CorrectionSampler(); const src: CorrectionSource = { correctionInto: () => false };
    const cur = { x: 1, y: 2, z: 0 }, prev = { x: 0.5, y: 2, z: 0 }; const p = cs.apply(src, 1, 5, cur, prev, { x: 0, y: 0, z: 0 });
    expect(p).toBe(prev); expect(cur).toEqual({ x: 1, y: 2, z: 0 }); expect(cs.size).toBe(0);
  });
});
