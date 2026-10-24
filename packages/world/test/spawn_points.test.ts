import { describe, it, expect } from "vitest";
import { CHUNK_SIZE, ProceduralGenerator, computeSpawnPoints, SPAWN_QUADRANTS } from "../src/index.js";

describe("computeSpawnPoints (ADR-106)", () => {
  for (const seed of [1234, 5, 99, 424242]) it(`seed ${seed}: four grass, clear, far-apart points, one per quadrant`, () => {
    const gen = new ProceduralGenerator({ seed }); const pts = computeSpawnPoints(gen);
    expect(pts).toHaveLength(4);
    expect(computeSpawnPoints(new ProceduralGenerator({ seed }))).toEqual(pts); // deterministic per seed
    pts.forEach((p, i) => {
      const [sx, sy] = SPAWN_QUADRANTS[i]!; expect(Math.sign(p.x)).toBe(sx); expect(Math.sign(p.y)).toBe(sy);
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(gen.tileAt(tx + dx, ty + dy)).toBe(3); // grass, never water
      const cx = Math.floor(tx / CHUNK_SIZE), cy = Math.floor(ty / CHUNK_SIZE);
      const nodes = gen.load(cx, cy).nodes; expect(nodes.some((n) => Math.abs(n.tx - tx) <= 2 && Math.abs(n.ty - ty) <= 2 && Math.floor(n.tx / CHUNK_SIZE) === cx)).toBe(false);
    });
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThan(96);
  });
  it("different seeds give different points", () => {
    expect(computeSpawnPoints(new ProceduralGenerator({ seed: 1 }))).not.toEqual(computeSpawnPoints(new ProceduralGenerator({ seed: 2 })));
  });
});
