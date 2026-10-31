import { describe, it, expect } from "vitest";
import { ProceduralGenerator } from "../src/generator.js";

// ADR-249: worldgen places Forest floor under woods, ShallowWater at shores and Snow on high cold rock.
describe("ADR-249 ground cover", () => {
  const g = new ProceduralGenerator({ seed: 1234 });
  const count = (gen: ProceduralGenerator): Map<number, number> => {
    const m = new Map<number, number>();
    for (let y = -300; y < 300; y += 3) for (let x = -300; x < 300; x += 3) { const t = gen.tileAt(x, y); m.set(t, (m.get(t) ?? 0) + 1); }
    return m;
  };
  it("produces Forest (7), ShallowWater (8) and Snow (6) in sensible amounts", () => {
    const m = count(g); const n = [...m.values()].reduce((a, b) => a + b, 0);
    for (const id of [6, 7, 8]) expect(m.get(id) ?? 0, `tile ${id}`).toBeGreaterThan(0);
    expect((m.get(7) ?? 0) / n).toBeLessThan(0.2);
    expect((m.get(8) ?? 0) / n).toBeLessThan(0.08);
    expect((m.get(6) ?? 0) / n).toBeLessThan(0.05);
  });
  it("shallow water always touches land or other shallows; deep water never borders land", () => {
    const land = (t: number): boolean => t !== 1 && t !== 8;
    for (let y = -150; y < 150; y++) for (let x = -150; x < 150; x++) {
      if (g.tileAt(x, y) !== 1) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(land(g.tileAt(x + dx, y + dy)), `deep water at ${x},${y} borders land`).toBe(false);
    }
  });
  it("chunks match tileAt and cover: false restores the plain bands", () => {
    const c = g.load(0, 0).chunk;
    for (let i = 0; i < c.tiles.length; i++) expect(g.tileAt(i % 32, Math.floor(i / 32))).toBe(c.tiles[i]);
    const off = count(new ProceduralGenerator({ seed: 1234, cover: false }));
    for (const id of [6, 7, 8]) expect(off.get(id) ?? 0).toBe(0);
  });
});
