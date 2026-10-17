import { describe, it, expect } from "vitest";
import { World, Transform, Weather, Rng, setTimeOfDay, TimeOfDay, stepN } from "@engine/core";
import { Emitter, Falloff, installEmitterIndex, buildingOcclusion, falloffAt, loadBuildPieces, BuildingGrid, ProceduralGenerator, installClimate, climateAt, setClimateModel, DefaultClimateModel, CHUNK_SIZE } from "../src/index.js";

const HEAT = 1, SMELL = 2;
describe("emitter field queries", () => {
  it("sampleField sums falloff contributions; nearestEmitters; incremental updates", () => {
    const w = new World(); const ix = installEmitterIndex(w);
    const a = w.create(); w.add(a, Transform, { x: 0, y: 0 }).add(a, Emitter, { kind: HEAT, radius: 10, strength: 20, falloff: Falloff.Linear });
    const b = w.create(); w.add(b, Transform, { x: 4, y: 0 }).add(b, Emitter, { kind: HEAT, radius: 4, strength: 10, falloff: Falloff.Quadratic });
    const c = w.create(); w.add(c, Transform, { x: 1, y: 0 }).add(c, Emitter, { kind: SMELL, radius: 50, strength: 1, falloff: Falloff.Constant });
    w.step(0.05);
    expect(ix.sampleField(HEAT, 2, 0)).toBeCloseTo(20 * 0.8 + 10 * 0.25);
    expect(ix.sampleField(SMELL, 40, 0)).toBe(1); expect(ix.sampleField(HEAT, 100, 100)).toBe(0); expect(ix.sampleField(9, 0, 0)).toBe(0);
    expect(ix.nearestEmitters(HEAT, 3, 0, 5).map((h) => h.entity)).toEqual([b, a]);
    w.setField(b, Transform, "x", 50); w.setField(a, Emitter, "kind", SMELL); w.step(0.05);
    expect(ix.sampleField(HEAT, 2, 0)).toBe(0); expect(ix.sampleField(SMELL, 2, 0)).toBeCloseTo(1 + 16);
    w.destroy(a); w.step(0.05); expect(ix.size).toBe(2);
    expect(falloffAt(Falloff.Quadratic, 0.5)).toBe(0.25); expect(falloffAt(Falloff.Constant, 1)).toBe(0);
    expect(ix.sampleField(SMELL, 1, 0, 10)).toBeCloseTo(1); // z distance 10 < radius 50
  });
  it("building occlusion blocks heat through solid walls", () => {
    const { registry } = loadBuildPieces([{ key: "wall", layer: 1, hp: 10 }]); const grid = new BuildingGrid(registry);
    const w = new World(); const ix = installEmitterIndex(w, { occlusion: buildingOcclusion(grid, { kinds: [HEAT] }) });
    const fire = w.create(); w.add(fire, Transform, { x: 0.5, y: 0.5 }).add(fire, Emitter, { kind: HEAT, radius: 10, strength: 10, falloff: Falloff.Linear });
    w.step(0.05); const open = ix.sampleField(HEAT, 4.5, 0.5);
    grid.place(registry.byKey("wall").id, 2, 0, 0); expect(ix.sampleField(HEAT, 4.5, 0.5)).toBe(0); expect(open).toBeGreaterThan(0);
    expect(ix.sampleField(HEAT, 0.5, 4.5)).toBeCloseTo(open);
  });
  it("benchmark: 200 players sampling 2k emitters", () => {
    const w = new World({ maxEntities: 4000 }); const ix = installEmitterIndex(w); const rng = new Rng(3); const SIZE = 32 * CHUNK_SIZE;
    for (let i = 0; i < 2000; i++) { const e = w.create(); w.add(e, Transform, { x: rng.range(0, SIZE), y: rng.range(0, SIZE) }).add(e, Emitter, { kind: HEAT, radius: rng.range(3, 12), strength: 10, falloff: Falloff.Linear }); }
    let t = performance.now(); w.step(0.05); const build = performance.now() - t;
    const players = Array.from({ length: 200 }, () => ({ x: rng.range(0, SIZE), y: rng.range(0, SIZE) }));
    const N = 50; let sum = 0; t = performance.now();
    for (let k = 0; k < N; k++) for (const p of players) sum += ix.sampleField(HEAT, p.x + k * 0.01, p.y);
    const per = (performance.now() - t) / N;
    console.log(`[bench] emitters: index build 2k=${build.toFixed(1)}ms, sampleField 200 players=${per.toFixed(3)}ms/tick (${((per / 200) * 1000).toFixed(1)}µs/sample), checksum ${sum.toFixed(0)}`);
    expect(per).toBeLessThan(20);
  });
});

describe("shelter queries", () => {
  const { registry } = loadBuildPieces([{ key: "wall", layer: 1, hp: 10 }, { key: "roof", layer: 0, hp: 10, solid: false }]);
  const W = registry.byKey("wall").id, R = registry.byKey("roof").id;
  function hut(grid: BuildingGrid, door = false) { // 3x3 interior at (1..3,1..3), walls ring at 0 and 4, roof at level 1
    for (let i = 0; i <= 4; i++) for (const [x, y] of [[i, 0], [i, 4], [0, i], [4, i]] as const) if (!(door && x === 2 && y === 4)) grid.place(W, x, y, 0);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) grid.place(R, x, y, 1);
  }
  it("isCovered, enclosure (cached, invalidated), exposure", () => {
    const g = new BuildingGrid(registry); hut(g);
    expect(g.isCovered(2, 2, 0)).toBe(true); expect(g.isCovered(6, 6, 0)).toBe(false); expect(g.isCovered(2, 2, 1)).toBe(false);
    expect(g.enclosure(2, 2, 0)).toEqual({ enclosed: true, roofed: true, size: 9 });
    expect(g.enclosure(2, 2, 0)).toBe(g.enclosure(1, 1, 0)); // shared cache entry
    expect(g.exposure(2.5, 2.5, 0, 0)).toBe(0);
    expect(g.enclosure(8, 8, 0, 64).enclosed).toBe(false);
    const doorWall = g.at(2, 4, 0); g.remove(doorWall); // open a door -> not enclosed any more
    expect(g.enclosure(2, 2, 0, 64).enclosed).toBe(false); expect(g.exposure(2.5, 2.5, 0)).toBe(0.5); // roofed but open
    expect(g.exposure(10.5, 10.5, 0)).toBe(1);
    g.place(W, 9, 10, 0); g.place(W, 8, 10, 0);
    expect(g.exposure(10.5, 10.5, 0, 0)).toBe(0.5); // wind blows +x; walls at x=9,8 upwind
  });
});

describe("climate", () => {
  it("base climate from generator, combined with time of day and weather via a model", () => {
    const gen = new ProceduralGenerator({ seed: 5 }); const w = new World(); installClimate(w, gen);
    const b = gen.baseClimate(100, 100); expect(b).toEqual(gen.baseClimate(100, 100));
    expect(b.altitude).toBe(gen.load(3, 3).chunk.height[(100 - 96) * 32 + (100 - 96)]);
    const cc = gen.chunkClimate(3, 3); expect(cc.humidity).toBeGreaterThan(0);
    w.env(TimeOfDay).dayLengthTicks = 100; setTimeOfDay(w, 12); const noon = climateAt(w, 100, 100).temperature;
    setTimeOfDay(w, 0); const night = climateAt(w, 100, 100).temperature; expect(noon - night).toBeCloseTo(12);
    w.env(Weather).intensity = 1; w.env(Weather).windSpeed = 7; const wet = climateAt(w, 100, 100);
    expect(wet.temperature).toBeCloseTo(night - 3); expect(wet.windSpeed).toBe(7); expect(wet.humidity).toBeCloseTo(Math.min(1, b.humidity + 0.4));
    setClimateModel(w, { sample: (base, ctx) => ({ ...DefaultClimateModel.sample(base, ctx), temperature: -40 }) });
    expect(climateAt(w, 0, 0).temperature).toBe(-40); stepN(w, 1);
  });
});
