import { describe, expect, it } from "vitest";
import { Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const LH = d.building.levelHeight;
const snap = (w: World, key: string, x: number, y: number, rot = 0): G.Snapped | number => G.snapPlacement(w, { piece: d.pieceId(key)!, x, y, level: 0, rot, tier: 1, variant: 0 });
const ok = (w: World, sn: G.Snapped | number): number => (typeof sn === "number" ? sn : G.validatePlacement(w, 0 as Entity, sn, { ignoreCost: true, ignoreRange: true }));
function place(w: World, key: string, x: number, y: number, rot = 0): Entity {
  const sn = snap(w, key, x, y, rot); if (typeof sn !== "object") throw new Error(`snap ${key} ${sn}`);
  const f = ok(w, sn); if (f) throw new Error(`validate ${key} ${f}`); return G.placePiece(w, 0, sn, { pay: false });
}
function floor(): World { const w = makeWorld(); for (const x of [20.5, 25.5]) place(w, "foundation", x, x); return w; }
const z = (w: World, e: Entity): number => w.get(e, Transform)!.z;

describe("ADR-162 small decor on flat surfaces", () => {
  it("defs: small flags + surface heights", () => {
    const p = (k: string) => d.pieces.get(d.pieceId(k)!)!;
    expect(p("vase").small).toBe(true); expect(p("table").surfaceHeight).toBeCloseTo(0.8); expect(p("chair_rustic").surfaceHeight).toBe(0); expect(p("table").small).toBe(false);
  });
  it("ghost/server snap a small piece to the table top, validate it, and keep rotation", () => {
    const w = floor(); place(w, "table", 20.5, 20.5);
    const sn = snap(w, "vase", 20.5, 20.5, 2) as G.Snapped;
    expect(sn.pos.z).toBeCloseTo(0.8); expect(ok(w, sn)).toBe(0);
    const v = G.placePiece(w, 0, sn, { pay: false }); expect(z(w, v)).toBeCloseTo(0.8);
    expect(G.structures(w).slotOf(v)!.rot).toBe(sn.slot.rot);
    const s2 = snap(w, "vase", 25.5, 25.5) as G.Snapped; expect(s2.pos.z).toBe(0); // no surface -> floor
  });
  it("non-small furniture does not rise onto a surface", () => {
    const w = floor(); place(w, "table", 20.5, 20.5);
    const sn = snap(w, "chair_rustic", 20.5, 20.5); expect(typeof sn === "object" ? sn.pos.z : 0).toBe(0);
  });
  it("small decor placed first is lifted when a table is built over it", () => {
    const w = floor(); const v = place(w, "vase", 20.5, 20.5); expect(z(w, v)).toBe(0);
    place(w, "table", 20.5, 20.5); expect(z(w, v)).toBeCloseTo(0.8);
  });
  it("destroying the surface drops its decor to the floor", () => {
    const w = floor(); const t = place(w, "table", 20.5, 20.5); const v = place(w, "vase", 20.5, 20.5);
    G.destroyPiece(w, t, G.DestroyCause.Demolish);
    expect(w.isAlive(v)).toBe(true); expect(z(w, v)).toBe(0);
  });
  it("persistence round-trip keeps the surface z (derived on load, no format change)", () => {
    const w = floor(); place(w, "table", 20.5, 20.5); place(w, "vase", 20.5, 20.5, 1);
    const bytes = G.encodeStructures(w, 0, 0); G.unloadStructures(w, "0,0" as never);
    const dec = G.decodeStructures(w, bytes);
    const vase = dec.pieces.find((e) => G.structures(w).def(e)?.key === "vase")!;
    expect(z(w, vase)).toBeCloseTo(0.8); expect(G.structures(w).slotOf(vase)!.rot).toBe(1);
  });
  it("upper level: surface height adds to the level floor", () => {
    const w = floor(); place(w, "table", 20.5, 20.5);
    expect(G.smallPieceZ(w, 20.5, 20.5, 0)).toBeCloseTo(0.8); expect(G.smallPieceZ(w, 20.5, 20.5, 1)).toBe(LH);
  });
});
