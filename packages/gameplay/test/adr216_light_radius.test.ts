import { describe, expect, it } from "vitest";
import { Transform, setTimeOfDay, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";
import { rehydrateLoadedStructures } from "../src/building/rehydrate.js";

const d = G.defaultDefs();
function place(w: World, key: string, x: number, y: number): Entity {
  const sn = G.snapPlacement(w, { piece: d.pieceId(key)!, x, y, level: 0, rot: 0, tier: 0, variant: 0 });
  if (typeof sn !== "object") throw new Error(`snap ${key} ${sn}`);
  return G.placePiece(w, 0, sn, { pay: false });
}
const lightOf = (w: World, piece: Entity) => G.attachmentsOf(w, piece).find((a) => w.getField(a, G.Emitter, "kind") === G.EmitterKind.Light)!;
const lightPieces = () => [...d.pieces.values()].filter((p) => p.light);

describe("ADR-216 realistic light radii (data)", () => {
  it("every light piece has an explicit lightRadius and the emitter uses it", () => {
    expect(lightPieces().length).toBeGreaterThanOrEqual(15);
    for (const p of lightPieces()) {
      expect(p.lightRadius, p.key).toBeGreaterThan(0);
      expect(G.emitterSpecs(p).find((s) => s.kind === G.EmitterKind.Light)?.radius, p.key).toBe(p.lightRadius);
    }
  });
  it("campfire lights 6-8 tiles, torches/lanterns proportionally, a candle is small, a street lamp is big", () => {
    const r = (k: string) => d.pieces.get(d.pieceId(k)!)!.lightRadius;
    expect(r("campfire")).toBeGreaterThanOrEqual(6); expect(r("campfire")).toBeLessThanOrEqual(8);
    for (const k of ["torch_stand", "lantern", "lantern_hanging"]) { expect(r(k), k).toBeGreaterThanOrEqual(5); expect(r(k), k).toBeLessThan(r("campfire")); }
    expect(r("candle")).toBeLessThan(r("lantern")); expect(r("lamp_post")).toBeGreaterThan(r("campfire"));
  });
  it("lightRadiusOf keeps the legacy fallback for defs without one", () => {
    expect(G.lightRadiusOf({ lightRadius: 0, heatRadius: 4 })).toBe(8); expect(G.lightRadiusOf({ lightRadius: 0, heatRadius: 0 })).toBe(4);
    expect(G.lightRadiusOf({ lightRadius: 6.5, heatRadius: 4 })).toBe(6.5);
  });
});

describe("ADR-216 gameplay light grid matches the visual radius", () => {
  it("a placed, lit campfire protects its full lightRadius", () => {
    const w = makeWorld(); const camp = place(w, "campfire", 20, 20);
    const f = G.attachmentsOf(w, camp).find((a) => w.has(a, G.Fuel))!; G.addItem(w, f, d.itemId("wood"), 20);
    w.set(f, G.Fuel, { lit: 1, burnUntilTick: 0 }); G.setEmittersLit(w, f, 1); G.invalidateLightGrid(w);
    const L = G.lightAt(w, 20.5, 20.5)!; expect(L.r).toBe(8);
    expect(G.lightAt(w, L.x + 7.5, L.y)).toBeDefined(); expect(G.lightAt(w, L.x + 12, L.y)).toBeUndefined();
  });
  it("a free-standing lit campfire (spawnStation) is a light too, and stops being one when it goes out", () => {
    const w = makeWorld(); const s = G.spawnStation(w, G.StationKind.Campfire, 30.5, 30.5);
    G.invalidateLightGrid(w); const L = G.lightAt(w, 33, 30.5)!;
    expect(L.e).toBe(s); expect(L.r).toBe(G.STATION_LIGHT_RADIUS[G.StationKind.Campfire]);
    G.snuffFire(w, s); G.invalidateLightGrid(w); expect(G.lightAt(w, 33, 30.5)).toBeUndefined();
    expect(G.activeLights(w).some((l) => l.e === s)).toBe(false);
  });
  it("a workbench (no fuel) is not a light", () => {
    const w = makeWorld(); G.spawnStation(w, G.StationKind.Workbench, 5, 5); G.invalidateLightGrid(w);
    expect(G.activeLights(w)).toHaveLength(0);
  });
  it("a walker keeps out of the larger lit radius at night", () => {
    const w = makeWorld(); setTimeOfDay(w, 0, 0);
    G.spawnStation(w, G.StationKind.Campfire, 20.5, 20.5, { burnSeconds: 3600 }); G.invalidateLightGrid(w);
    const p = G.spawnPlayer(w, { x: 20.5, y: 22 }); w.set(p, G.Health, { hp: 1e6, max: 1e6 });
    const z = G.spawnZombie(w, "zombie_walker", 30.5, 20.5);
    let minD = Infinity; for (let i = 0; i < 20 * 15; i++) { steps(w, 1); const t = w.get(z, Transform)!; minD = Math.min(minD, Math.hypot(t.x - 20.5, t.y - 20.5)); }
    expect(minD).toBeGreaterThan(7.5);
  });
  it("rehydrate refreshes an old save's light emitter radius to the def", () => {
    const w = makeWorld(); const lamp = place(w, "lamp_post", 10, 10); const a = lightOf(w, lamp);
    w.setField(a, G.Emitter, "radius", 4); // pre-ADR-216 save
    G.loadedQueue(w).atts.push(a); rehydrateLoadedStructures(w);
    expect(w.getField(a, G.Emitter, "radius")).toBe(d.pieces.get(d.pieceId("lamp_post")!)!.lightRadius);
  });
});
