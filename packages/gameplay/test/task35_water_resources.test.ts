/**
 * ADR-255: real worldgen.json — every listed gatherable / wild plant is placed for many seeds;
 * Task 33 safe radius stays 20.
 */
import { describe, expect, it } from "vitest";
import { ProceduralGenerator, NODE_GUARANTEE_RADIUS, surveyWaterFeatures, isWaterId, waterFeatureLayout, riverPoint } from "@engine/world";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

describe("ADR-255 gameplay worldgen coverage + safe zones", () => {
  it("SAFE_SPAWN_RADIUS stays 20", () => {
    expect(G.SAFE_SPAWN_RADIUS).toBe(20);
    const w = makeWorld();
    G.setSpawnPoints(w, [{ x: 0, y: 0 }]);
    expect(G.inSpawnSafeRadius(w, 19, 0)).toBe(true);
    expect(G.inSpawnSafeRadius(w, 21, 0)).toBe(false);
  });

  it("every worldgen.json node kind appears within NODE_GUARANTEE_RADIUS for many seeds", () => {
    const defs = G.defaultDefs();
    const bands = G.worldgenBands(defs);
    const all = new Set<number>();
    for (const b of bands) for (const k of b.nodeKinds ?? []) all.add(k);
    expect(all.size).toBeGreaterThanOrEqual(60); // live data: 70 gatherables / wild plants

    for (let i = 0; i < 16; i++) {
      const seed = ((i * 2654435761) >>> 0) || 1;
      const g = new ProceduralGenerator({ seed, bands });
      const found = new Set<number>();
      const R = NODE_GUARANTEE_RADIUS; const cs = 32;
      for (let cy = Math.floor(-R / cs) - 1; cy <= Math.floor(R / cs) + 1; cy++)
        for (let cx = Math.floor(-R / cs) - 1; cx <= Math.floor(R / cs) + 1; cx++)
          for (const n of g.load(cx, cy).nodes) {
            if (Math.abs(n.tx) >= R || Math.abs(n.ty) >= R) continue;
            found.add(n.kind);
          }
      const miss = [...all].filter((k) => !found.has(k)).map((id) => defs.resources.get(id)?.key ?? `#${id}`);
      expect(miss, `seed ${seed}`).toEqual([]);
    }
  });

  it("lake, river and pond water exist for many seeds (real bands)", () => {
    const defs = G.defaultDefs();
    const bands = G.worldgenBands(defs);
    for (let i = 0; i < 16; i++) {
      const seed = ((i * 40503 + 9) >>> 0) || 1;
      const g = new ProceduralGenerator({ seed, bands });
      const L = waterFeatureLayout(seed);
      const isW = (t: number) => t === 1 || t === 8;
      expect(isW(g.tileAt(Math.floor(L.lake.x), Math.floor(L.lake.y)))).toBe(true);
      expect(isW(g.tileAt(Math.floor(L.pond.x), Math.floor(L.pond.y)))).toBe(true);
      const rp = riverPoint(L, -15);
      expect(isW(g.tileAt(Math.floor(rp.x), Math.floor(rp.y)))).toBe(true);
      const s = surveyWaterFeatures(seed, (x, y) => g.tileAt(x, y), isWaterId);
      expect(s.forced.lake && s.forced.river && s.forced.pond).toBe(true);
    }
  });
});
