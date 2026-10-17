import { describe, it, expect } from "vitest";
import { loadBuildPieces, BuildingGrid, SUBTILE, ChunkedSpatialIndex } from "../src/index.js";

const RAW = [
  { key: "foundation", footprint: { w: 2, h: 2 }, layer: 0, hp: 500, cost: [{ resource: "stone", amount: 10 }], sockets: [{ x: 0, y: 0, kind: 1 }, { x: 8, y: 0, kind: 1 }], solid: false },
  { key: "wall", footprint: { w: 2, h: 1 }, layer: 1, hp: 200, levels: 1, cost: [{ resource: "wood", amount: 4 }], sockets: [{ x: 8, y: 2, kind: 2 }] },
  { key: "pillar", layer: 1, hp: 300, levels: 2 },
];
const res: Record<string, number> = { wood: 1, stone: 2 };

describe("BuildPieceDef loading", () => {
  it("validates and assigns stable ids from a lock", () => {
    const a = loadBuildPieces(RAW, { resolveResource: (k) => res[k] });
    expect(a.registry.byKey("foundation").cost).toEqual([{ resource: 2, amount: 10 }]);
    const b = loadBuildPieces([{ key: "aaa_door", hp: 50 }, ...RAW], { lock: a.lock, resolveResource: (k) => res[k] });
    for (const r of RAW) expect(b.registry.byKey(r.key).id).toBe(a.registry.byKey(r.key).id);
    expect(b.registry.byKey("aaa_door").id).toBe(4);
    expect(() => loadBuildPieces([{ key: "x", hp: 0 }, { key: "x", hp: 1, cost: [{ resource: "gold", amount: 1 }] }], { resolveResource: (k) => res[k] })).toThrow(/hp must be > 0[\s\S]*duplicate[\s\S]*unknown resource/);
  });
});

describe("BuildingGrid", () => {
  const { registry } = loadBuildPieces(RAW, { resolveResource: (k) => res[k] });
  const F = registry.byKey("foundation").id, W = registry.byKey("wall").id, P = registry.byKey("pillar").id;
  it("multi-tile occupancy across chunk borders, layers, rotation, collision", () => {
    const g = new BuildingGrid(registry);
    const f = g.place(F, 31, 31, 0); expect(f).toBeGreaterThan(0);
    for (const [x, y] of [[31, 31], [32, 31], [31, 32], [32, 32]]) expect(g.at(x!, y!, 0)).toBe(f);
    expect(g.canPlace(F, 32, 32, 0)).toEqual({ ok: false, blockers: [f] });
    const w = g.place(W, 31, 31, 0, 1); expect(w).toBeGreaterThan(0); // different layer, rotated 2x1 -> 1x2
    expect(g.at(31, 32, 0, 1)).toBe(w); expect(g.at(32, 31, 0, 1)).toBe(0);
    expect(g.isBlocked(31, 32)).toBe(true); expect(g.isBlocked(32, 32)).toBe(false); // foundation not solid
    expect(g.place(W, 31, 32, 0)).toBe(0);
    expect(new Set(g.queryRect(30, 30, 40, 40, 0))).toEqual(new Set([f, w]));
    expect(g.remove(w)).toBe(true); expect(g.at(31, 32, 0, 1)).toBe(0);
    expect(g.canPlace(P, 0, 0, 15).outOfRange).toBe(true);
  });
  it("support graph, neighbors, stability hook", () => {
    const g = new BuildingGrid(registry);
    const f = g.place(F, 0, 0, 0); const p = g.place(P, 0, 0, 1); const top = g.place(W, 0, 0, 3);
    const side = g.place(F, 2, 0, 0);
    expect(g.supportsOf(p)).toEqual([f]); expect(g.dependentsOf(f)).toEqual([p]); expect(g.dependentsOf(p)).toEqual([top]);
    expect(g.neighborsOf(f)).toEqual([side]);
    g.stabilityRule = (grid, i) => i.z === 0 || grid.supportsOf(i.id).length > 0;
    expect(g.unstable()).toEqual([]); g.remove(p); expect(g.unstable()).toEqual([top]);
  });
  it("sockets rotate with the piece and snap finds nearest", () => {
    const g = new BuildingGrid(registry); const f = g.place(F, 10, 10, 0, 0);
    expect(g.socketsOf(f)).toEqual([{ sx: 40, sy: 40, z: 0, kind: 1 }, { sx: 48, sy: 40, z: 0, kind: 1 }]);
    const s = g.snap(47 , 41, 0, { kind: 1 }); expect(s).toMatchObject({ sx: 48, sy: 40, owner: f });
    expect(g.snap(47, 41, 1)).toBeUndefined(); expect(g.snap(47, 41, 0, { kind: 2 })).toBeUndefined();
    const r = g.place(F, 20, 20, 0, 1); expect(g.socketsOf(r)[1]).toEqual({ sx: 20 * SUBTILE + 8, sy: 20 * SUBTILE + 8, z: 0, kind: 1 });
  });
});

describe("ChunkedSpatialIndex", () => {
  it("inserts, moves across chunks, queries rect/radius", () => {
    const ix = new ChunkedSpatialIndex();
    ix.insert(1, 1, 1); ix.insert(2, 31.5, 31.5); ix.insert(3, 32.5, 32.5); ix.insert(4, -100000.5, 7);
    expect(new Set(ix.queryRect(30, 30, 33, 33))).toEqual(new Set([2, 3]));
    expect(ix.queryRadius(32, 32, 0.8).sort()).toEqual([2, 3]);
    expect(ix.queryRadius(-100000, 7, 1)).toEqual([4]);
    ix.insert(3, 1.5, 1.5); expect(ix.queryRadius(1, 1, 1).sort()).toEqual([1, 3]);
    ix.remove(4); expect(ix.chunkCount).toBe(1); expect(ix.size).toBe(3);
  });
});
