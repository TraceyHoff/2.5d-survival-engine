import { describe, it, expect } from "vitest";
import { World, defineComponent, entityIndex } from "@engine/core";
import { Chunk, ChunkManager, ProceduralGenerator, TileMap, encodeTileDelta, decodeTileDelta, applyTileDelta, BuildingGrid, BuildingChangeKind, loadBuildPieces, encodeChunk, decodeChunk, type AsyncChunkProvider, type GeneratedChunk } from "../src/index.js";

describe("tile change records", () => {
  it("records (index, old, new), drains per chunk, compact delta round-trip", () => {
    const m = new TileMap(); m.setTile(1, 1, 5); m.setTile(1, 1, 6); m.setTile(1, 1, 6); m.setTile(40, 0, 2);
    const v = m.getChunk(0, 0)!.version; const sets = m.tileChanges();
    expect(sets.map((s) => s.key)).toEqual(["0,0", "1,0"]); expect(sets[0]!.changes).toEqual([33, 0, 5, 33, 5, 6]); expect(sets[0]!.version).toBe(v);
    expect(m.tileChanges()).toEqual([]);
    const bytes = encodeTileDelta(sets[0]!); expect(bytes.length).toBe(10); expect(decodeTileDelta(bytes)).toEqual({ version: v, tiles: [[33, 6]] });
    const client = new Chunk(0, 0); applyTileDelta(client, bytes); expect(client.get(1, 1)).toBe(6); expect(client.version).toBe(v);
    expect(() => decodeTileDelta(bytes.slice(0, 7))).toThrow();
  });
  it("ChunkManager tracks edits on loaded chunks and forgets evicted ones", () => {
    const cm = new ChunkManager({ provider: new ProceduralGenerator({ seed: 1 }), loadRadius: 0, unloadMargin: 0, cacheSize: 0 });
    cm.setSource({ id: 1, x: 0, y: 0 }); cm.update(); expect(cm.tileChanges()).toEqual([]);
    cm.trySetTile(3, 3, 999); cm.trySetTile(3, 4, 998); expect(cm.tileChanges()[0]!.changes.length).toBe(6);
    cm.trySetTile(3, 3, 1); cm.setSource({ id: 1, x: 500, y: 500 }); cm.update(); expect(cm.tileChanges()).toEqual([]);
  });
});

describe("building change records", () => {
  it("placed / hp / removed recorded in order and drained; setField marks dirty", () => {
    const { registry } = loadBuildPieces([{ key: "wall", layer: 1, hp: 100 }]); const g = new BuildingGrid(registry);
    const id = g.place(registry.byKey("wall").id, 33, 2, 0); expect(g.damage(id, 30)).toBe(70); g.setHp(id, 70); expect(g.damage(id, 500)).toBe(0); g.remove(id);
    const ch = g.buildingChanges(); expect(ch.map((c) => [c.kind, c.hp])).toEqual([[BuildingChangeKind.Placed, 100], [BuildingChangeKind.Hp, 70], [BuildingChangeKind.Hp, 0], [BuildingChangeKind.Removed, 0]]);
    expect(ch[0]!.key).toBe("1,0"); expect(g.buildingChanges()).toEqual([]); expect(g.setHp(999, 1)).toBe(false); expect(g.damage(999, 1)).toBe(-1);
    g.recordChanges = false; g.place(registry.byKey("wall").id, 0, 0, 0); expect(g.buildingChanges()).toEqual([]);
    const w = new World(); const C = defineComponent("C", { a: "f32" }); w.register(C); const e = w.create(); w.add(e, C); w.clearChanges();
    w.setField(e, C, "a", 3); expect([...w.changed(C)]).toEqual([e]); void entityIndex;
  });
});

describe("async ChunkProvider", () => {
  class FakeAsync implements AsyncChunkProvider {
    calls: string[] = []; resolvers = new Map<string, (g: GeneratedChunk | undefined) => void>(); gen = new ProceduralGenerator({ seed: 2 });
    load(cx: number, cy: number): Promise<GeneratedChunk | undefined> { const k = `${cx},${cy}`; this.calls.push(k); return new Promise((r) => this.resolvers.set(k, r)); }
    resolve(k: string): void { const [x, y] = k.split(",").map(Number); this.resolvers.get(k)!(this.gen.load(x!, y!)); }
  }
  it("pending state, no duplicate requests, late results after unload ignored", async () => {
    const p = new FakeAsync(); const cm = new ChunkManager({ provider: p, loadRadius: 0, unloadMargin: 0, cacheSize: 0 }); const loaded: string[] = [];
    cm.onLoad((c) => loaded.push(c.key));
    cm.setSource({ id: 1, x: 0, y: 0 }); cm.update(); cm.update(); cm.update();
    expect(p.calls).toEqual(["0,0"]); expect(cm.isPending("0,0")).toBe(true); expect(cm.pendingLoads).toBe(1); expect(cm.getChunk(0, 0)).toBeUndefined();
    p.resolve("0,0"); await cm.settle(); expect(loaded).toEqual(["0,0"]); expect(cm.isActive("0,0")).toBe(true); expect(cm.pendingLoads).toBe(0);
    cm.setSource({ id: 1, x: 100, y: 0 }); cm.update(); expect(p.calls).toEqual(["0,0", "3,0"]);
    cm.setSource({ id: 1, x: 200, y: 0 }); cm.update(); // 3,0 no longer wanted while in flight
    p.resolve("3,0"); await Promise.resolve(); await Promise.resolve(); expect(cm.getChunk(3, 0)).toBeUndefined(); expect(cm.stats.asyncDropped).toBe(1);
    p.resolve("6,0"); await cm.settle(); expect(loaded).toEqual(["0,0", "6,0"]);
    const bad = new ChunkManager({ provider: { load: () => Promise.reject(new Error("io")) }, loadRadius: 0, unloadMargin: 0 });
    bad.setSource({ id: 1, x: 0, y: 0 }); bad.update(); await bad.settle().catch(() => {}); await Promise.resolve(); expect(bad.stats.loadErrors).toBe(1); expect(bad.pendingLoads).toBe(0);
  });
});

describe("encodeChunk 3000 pieces", () => {
  it("fast path stays byte-compatible and fast", () => {
    const { registry } = loadBuildPieces([{ key: "f", layer: 0, hp: 100 }, { key: "w", layer: 1, hp: 50 }, { key: "r", layer: 2, hp: 10 }]);
    const g = new BuildingGrid(registry); let n = 0;
    for (let z = 0; z < 4 && n < 3000; z++) for (let la = 1; la <= 3 && n < 3000; la++) for (let y = 0; y < 32 && n < 3000; y++) for (let x = 0; x < 32 && n < 3000; x++) if (g.place(la, x, y, z, 0)) n++;
    const c = new Chunk(0, 0); c.set(3, 3, 7);
    let t = performance.now(); const bytes = encodeChunk(c, { buildings: g }); const cold = performance.now() - t;
    for (let i = 0; i < 100; i++) encodeChunk(c, { buildings: g }); t = performance.now(); for (let i = 0; i < 300; i++) encodeChunk(c, { buildings: g }); const warm = (performance.now() - t) / 300;
    console.log(`[bench] encodeChunk 3000 pieces: cold ${cold.toFixed(2)} ms, warm ${warm.toFixed(3)} ms, ${bytes.length} bytes`);
    const g2 = new BuildingGrid(registry); const d = decodeChunk(bytes, { buildings: g2 }); expect(g2.count).toBe(3000); expect(d.chunk.get(3, 3)).toBe(7);
    expect(encodeChunk(c, { buildings: g })).toEqual(bytes); expect(warm).toBeLessThan(5);
  });
});
