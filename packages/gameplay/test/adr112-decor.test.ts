import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs();
const manifest = JSON.parse(readFileSync(new URL("../../assets/pack/manifest.json", import.meta.url), "utf8")) as { sprites: { building?: { piece: string } }[] };
// ADR-242: the building pack (lit/unlit hearths, lantern, mirror...) is pack art too, now that their fallbacks are gone
const building = JSON.parse(readFileSync(new URL("../../assets/pack/building/manifest.building.json", import.meta.url), "utf8")) as typeof manifest;
const ART = new Set([...manifest.sprites, ...building.sprites].flatMap((s) => (s.building ? [s.building.piece] : [])));
const raw = JSON.parse(readFileSync(new URL("../data/pieces.json", import.meta.url), "utf8")) as { pieces: { key: string; $decor?: boolean }[] };
const decor = raw.pieces.filter((p) => p.$decor).map((p) => d.pieces.get(d.pieceId(p.key)!)!);
function snap(w: World, key: string, x: number, y: number, rot = 0): G.Snapped | number { return G.snapPlacement(w, { piece: d.pieceId(key)!, x, y, level: 0, rot, tier: 1, variant: 0 }); }
function place(w: World, key: string, x: number, y: number, rot = 0): Entity {
  const sn = snap(w, key, x, y, rot); if (typeof sn !== "object") throw new Error(`snap ${key} ${sn}`);
  const f = G.validatePlacement(w, 0 as Entity, sn, { ignoreCost: true, ignoreRange: true }); if (f) throw new Error(`validate ${key} ${f}`);
  return G.placePiece(w, 0, sn, { pay: false });
}

describe("ADR-112 decor catalog", () => {
  it("has 200+ placeable entries across every category", () => {
    const variants = decor.reduce((s, p) => s + p.variants, 0);
    expect(decor.length).toBeGreaterThanOrEqual(100); expect(variants).toBeGreaterThanOrEqual(200);
    for (const c of ["furniture", "lighting", "decor", "plants", "wall", "rugs", "outdoor"]) expect(decor.some((p) => p.category === c)).toBe(true);
    for (const p of decor) { expect(p.variantNames).toHaveLength(p.variants); expect(p.cost.length + p.extraCost.length).toBeGreaterThan(0); }
  });
  it("every decor piece resolves to pack art through sprite_fallbacks", () => {
    for (const p of decor) expect(G.resolveSprite(p.key, (k) => ART.has(k))?.key, p.key).toBeDefined();
  });
  it("rugs are layer 1 so furniture and decor stand on them", () => {
    const w = makeWorld();
    place(w, "rug_2x2", 20, 20); place(w, "chair_rustic", 20, 20); place(w, "vase", 20.5, 20.5);
    expect(typeof snap(w, "rug_1x1", 20, 20) === "object" && G.validatePlacement(w, 0 as Entity, snap(w, "rug_1x1", 20, 20) as G.Snapped, { ignoreCost: true, ignoreRange: true })).toBe(G.BuildFail.Occupied);
  });
  it("lights and stoves use the fuel system; storage reuses containers", () => {
    for (const k of ["candle", "chandelier", "wall_sconce", "lamp_post", "stove_iron"]) { const p = d.pieces.get(d.pieceId(k)!)!; expect(p.fired && p.light && p.container >= 1).toBe(true); }
    const w = makeWorld(); const e = place(w, "wardrobe_fine", 30, 30);
    expect(G.attachmentsOf(w, e).some((a) => (w.get(a, G.Container)?.slotCount ?? 0) === 10)).toBe(true);
  });
});

describe("ADR-112 wall mounts", () => {
  function hut(w: World): Entity { for (const x of [9.5, 10.5, 11.5]) place(w, "foundation", x, 10.5); return place(w, "wall", 10.5, 10.02); } // ADR-211: mid edge (1x1 edges are L-corner slots)
  it("need a wall, hang on either face, and fall with it", () => {
    const w = makeWorld();
    expect(G.validatePlacement(w, 0 as Entity, snap(w, "painting_wall", 10.5, 10.02) as G.Snapped, { ignoreCost: true, ignoreRange: true })).toBe(G.BuildFail.NoSocket);
    const wall = hut(w);
    const a = place(w, "painting_wall", 10.5, 10.02, 0); const b = place(w, "trophy_mount", 10.5, 10.02, 2);
    expect(G.validatePlacement(w, 0 as Entity, snap(w, "poster", 10.5, 10.02, 0) as G.Snapped, { ignoreCost: true, ignoreRange: true })).toBe(G.BuildFail.Occupied);
    expect(G.structures(w).mountsOn(10, 10, 0, G.EdgeSide.North).sort()).toEqual([a, b].sort());
    G.destroyPiece(w, wall, 0 as G.DestroyCause);
    expect(G.structures(w).info.has(a) || G.structures(w).info.has(b)).toBe(false);
  });
});

describe("ADR-112 planters", () => {
  it("placing a planter makes soil that accepts herbs on any terrain", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 40, y: 41 });
    place(w, "herb_planter", 40.5, 40.5);
    expect(G.inPlanter(w, 40.5, 40.5)).toBe(true);
    expect(G.plant(w, p, "herbs_seeds", 40.5, 40.5)).toBe(G.FarmFail.None);
  });
});
