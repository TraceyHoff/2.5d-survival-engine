import { describe, expect, it } from "vitest";
import { Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs();
const F = G.FINE_ROT;
const req = (key: string, x: number, y: number, rot = 0) => ({ piece: d.pieceId(key)!, x, y, level: 0, rot, tier: 1, variant: 0 });
const snap = (w: World, key: string, x: number, y: number, rot = 0) => G.snapPlacement(w, req(key, x, y, rot)) as G.Snapped;
const ok = (w: World, sn: G.Snapped) => G.validatePlacement(w, 0 as Entity, sn, { ignoreCost: true, ignoreRange: true });
function place(w: World, key: string, x: number, y: number, rot = 0): Entity {
  const sn = snap(w, key, x, y, rot); const f = ok(w, sn); if (f) throw new Error(`validate ${key} ${f}`); return G.placePiece(w, 0, sn, { pay: false });
}
const pieces = [...d.pieces.values()];
const vertexKey = pieces.find((p) => p.placement === G.Placement.Free && p.snap === "vertex")?.key;
const claimKey = pieces.find((p) => p.placement === G.Placement.Free && p.privilegeRadius > 0)?.key;

describe("ADR-174 free (off-grid) placement", () => {
  it("fine flag: 1/16-tile position and 15° (24-step) facing for decor", () => {
    const sn = snap(makeWorld(), "vase", 20.33, 20.71, F | 5);
    expect(sn.pos.x).toBeCloseTo(20.3125); expect(sn.pos.y).toBeCloseTo(20.6875);
    expect(sn.slot.rot).toBe(F | 5); expect(G.isFineRot(sn.def, sn.slot.rot)).toBe(true);
    const s0 = snap(makeWorld(), "vase", 20.5, 20.5, F); const s1 = snap(makeWorld(), "vase", 20.5, 20.5, F | 1);
    expect(Math.abs(s1.pos.facing - s0.pos.facing) % (2 * Math.PI)).toBeCloseTo(Math.PI / 12);
    expect(snap(makeWorld(), "vase", 20.5, 20.5, F | 30).slot.rot).toBe(F | 6); // wraps mod 24
  });
  it("snap on keeps the quarter-tile grid", () => {
    const sn = snap(makeWorld(), "vase", 20.33, 20.71, 1); expect(sn.pos.x).toBeCloseTo(20.25); expect(sn.slot.rot & F).toBe(0);
  });
  it("structural, vertex and claim pieces ignore the fine flag", () => {
    const f = snap(makeWorld(), "foundation", 20.33, 20.71, F | 3); expect(f.slot.rot).toBe(3);
    expect(G.fineEligible(d.pieces.get(d.pieceId("foundation")!)!)).toBe(false);
    for (const k of [vertexKey, claimKey]) if (k) { const s = snap(makeWorld(), k, 20.33, 20.71, F | 3); expect(s.slot.rot & F).toBe(0); }
  });
  it("overlap with an occupied tile is rejected; ghost == server transform", () => {
    const w = makeWorld(); const sn = snap(w, "chair_rustic", 20.4375, 20.5625, F | 7);
    const e = G.placePiece(w, 0, sn, { pay: false }); const t = w.get(e, Transform)!;
    expect(t.x).toBeCloseTo(sn.pos.x); expect(t.y).toBeCloseTo(sn.pos.y); expect(t.facing).toBeCloseTo(sn.pos.facing);
    expect(ok(w, snap(w, "chair_rustic", 20.5, 20.5, F))).not.toBe(0);
  });
  it("persistence round-trip keeps exact x/y and fine rot", () => {
    const w = makeWorld(); place(w, "vase", 20.3125, 21.0625, F | 11);
    const bytes = G.encodeStructures(w, 0, 0); G.unloadStructures(w, "0,0" as never);
    const dec = G.decodeStructures(w, bytes); const v = dec.pieces.find((e) => G.structures(w).def(e)?.key === "vase")!;
    const t = w.get(v, Transform)!; expect(t.x).toBeCloseTo(20.3125); expect(t.y).toBeCloseTo(21.0625);
    expect(G.structures(w).slotOf(v)!.rot).toBe(F | 11);
    // a second world decoding the same bytes (MP replica / reload) derives the identical slot
    const w2 = makeWorld(); const d2 = G.decodeStructures(w2, bytes); const v2 = d2.pieces[0]!;
    const strip = (s: G.Slot | undefined) => { const { gridId: _g, ...r } = s as G.Slot & { gridId?: number }; return r; };
    expect(strip(G.structures(w2).slotOf(v2))).toEqual(strip(G.structures(w).slotOf(v)));
  });
  it("decor-on-surface (ADR-162) works off-grid", () => {
    const w = makeWorld(); for (const x of [20.5]) place(w, "foundation", x, x); place(w, "table", 20.5, 20.5);
    const sn = snap(w, "vase", 20.3125, 20.6875, F | 3); expect(sn.pos.z).toBeCloseTo(0.8); expect(ok(w, sn)).toBe(0);
  });
});
