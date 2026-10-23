import { describe, it, expect } from "vitest";
import { World, Transform, type Entity } from "@engine/core";
import { PopulationSpawner, chunkKey, type PhaseKey, type PopulationHost, type SpawnEntry } from "../src/index.js";

const entry = (o: Partial<SpawnEntry> = {}): SpawnEntry => ({ kind: "z", category: "zombie", density: 2, minPlayerDistance: 0, perChunkCap: 3, globalCap: 100, despawnDistance: 500, ...o });
function setup(entries: SpawnEntry[], o: { seed?: number; phase?: PhaseKey; blocked?: (x: number, y: number) => boolean; chunks?: string[]; persistent?: Set<Entity> } = {}) {
  const w = new World({ seed: o.seed ?? 7 }); const views = [{ x: 48, y: 48 }]; let phase: PhaseKey = o.phase ?? "day";
  const host: PopulationHost = {
    chunks: () => o.chunks ?? [chunkKey(0, 0), chunkKey(1, 0), chunkKey(0, 1), chunkKey(1, 1)],
    viewpoints: () => views, phase: () => phase, tileAt: () => 3, blocked: o.blocked ?? (() => false),
    spawn: (_e, x, y) => { const e = w.create(); w.add(e, Transform, { x, y }); return e; },
    despawn: (e) => w.destroy(e),
    position: (e) => (w.isAlive(e) ? { x: w.getField(e, Transform, "x")!, y: w.getField(e, Transform, "y")! } : undefined),
    persistent: (e) => o.persistent?.has(e) ?? false,
  };
  const sp = new PopulationSpawner(w, entries, host);
  return { w, sp, views, setPhase: (p: PhaseKey) => (phase = p) };
}
const run = (s: ReturnType<typeof setup>, n: number) => { for (let i = 0; i < n; i++) { s.w.step(1 / 20); s.sp.step(); } };

describe("PopulationSpawner", () => {
  it("respects per-chunk and global caps", () => {
    const a = setup([entry({ perChunkCap: 2, density: 5 })]); run(a, 50); expect(a.sp.count("z")).toBe(8);
    const b = setup([entry({ globalCap: 3, density: 5 })]); run(b, 50); expect(b.sp.count("z")).toBe(3);
  });
  it("weights by time of day (more at night)", () => {
    const e = entry({ density: 0.5, perChunkCap: 10, timeWeights: { day: 0.25, night: 4 } });
    const d = setup([e], { phase: "day" }); run(d, 6); const n = setup([e], { phase: "night" }); run(n, 6);
    expect(n.sp.count("z")).toBeGreaterThan(d.sp.count("z"));
    const zero = setup([entry({ timeWeights: { day: 0 } })]); run(zero, 20); expect(zero.sp.count("z")).toBe(0);
  });
  it("never spawns on blocked tiles (claims, buildings) or too near players", () => {
    const s = setup([entry({ minPlayerDistance: 20 })], { blocked: (x) => x < 32 }); run(s, 40);
    for (const e of s.sp.tracked.keys()) { const x = s.w.getField(e, Transform, "x")!, y = s.w.getField(e, Transform, "y")!; expect(x).toBeGreaterThanOrEqual(32); expect(Math.hypot(x - 48, y - 48)).toBeGreaterThanOrEqual(20); }
    expect(s.sp.count("z")).toBeGreaterThan(0);
  });
  it("despawns far from all viewpoints unless persistent", () => {
    const keep = new Set<Entity>(); const s = setup([entry({ despawnDistance: 100 })], { persistent: keep }); run(s, 10);
    const first = [...s.sp.tracked.keys()][0]!; keep.add(first); const before = s.sp.count("z");
    s.views[0] = { x: 5000, y: 5000 }; const st = s.sp.step();
    expect(st.despawned).toBe(before - 1); expect(s.sp.tracked.has(first)).toBe(true);
  });
  it("is deterministic for a seed", () => {
    const pos = (s: ReturnType<typeof setup>) => [...s.sp.tracked.keys()].map((e) => [s.w.getField(e, Transform, "x")!, s.w.getField(e, Transform, "y")!]);
    const a = setup([entry({ density: 0.7, group: [1, 3] })]), b = setup([entry({ density: 0.7, group: [1, 3] })]);
    run(a, 30); run(b, 30); expect(pos(a)).toEqual(pos(b));
  });
});
