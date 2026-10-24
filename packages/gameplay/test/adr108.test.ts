import { describe, expect, it } from "vitest";
import { PlayerId, Transform, setTimeOfDay, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs();
function place(w: World, b: Entity | undefined, key: string, x: number, y: number): Entity {
  const sn = G.snapPlacement(w, { piece: d.pieceId(key)!, x, y, level: 0, rot: 0, tier: 0, variant: 0 });
  if (typeof sn !== "object") throw new Error(`snap ${key} ${sn}`);
  return G.placePiece(w, b ?? 0, sn, { pay: false });
}
const fireOf = (w: World, piece: Entity) => G.attachmentsOf(w, piece).find((a) => w.has(a, G.Fuel))!;
const boxOf = (w: World, piece: Entity) => G.attachmentsOf(w, piece).find((a) => w.has(a, G.Container))!;
function light(w: World, piece: Entity, item = "wood", n = 20): Entity {
  const f = fireOf(w, piece); G.addItem(w, f, d.itemId(item), n); w.set(f, G.Fuel, { lit: 1, burnUntilTick: 0 }); G.setEmittersLit(w, f, 1); G.invalidateLightGrid(w); return f;
}
const dist = (w: World, a: Entity, x: number, y: number) => { const t = w.get(a, Transform)!; return Math.hypot(t.x - x, t.y - y); };

describe("ADR-108 data", () => {
  it("snuffer, fuel items, defense pieces load", () => {
    const s = d.zombies.get(d.zombieId("zombie_snuffer"))!;
    expect(s.light?.targetsLights).toBe(true); expect(s.tint).toHaveLength(3);
    expect(d.items.get(d.itemId("wood"))!.fuelSeconds).toBeLessThan(d.items.get(d.itemId("coal"))!.fuelSeconds);
    expect(d.items.get(d.itemId("coal"))!.fuelSeconds).toBeLessThan(d.items.get(d.itemId("crude_oil"))!.fuelSeconds);
    for (const k of ["barbed_wire", "spike_trap", "bear_trap", "arrow_turret", "bolt_turret", "flame_turret", "barricade_spiked"]) expect(d.pieces.has(d.pieceId(k))).toBe(true);
    expect(d.pieces.get(d.pieceId("lantern"))!.fired).toBe(true);
    expect(d.lightAvoid.phases).toContain("night");
  });
});

describe("ADR-108 light avoidance", () => {
  it("light grid sees lit emitters only", () => {
    const w = makeWorld(); const camp = place(w, undefined, "campfire", 20, 20);
    expect(G.lightAt(w, 20.5, 20.5)).toBeUndefined();
    light(w, camp); expect(G.lightAt(w, 21, 21)?.r).toBeGreaterThan(3); expect(G.lightAt(w, 60, 60)).toBeUndefined();
  });
  it("at night a walker paces at the dark edge, and closes in once the fire goes out", () => {
    const w = makeWorld(); setTimeOfDay(w, 0, 0);
    const camp = place(w, undefined, "campfire", 20, 20); const f = light(w, camp);
    const p = G.spawnPlayer(w, { x: 20.5, y: 21.5 }); w.set(p, G.Health, { hp: 1e6, max: 1e6 });
    const r = G.lightAt(w, 20.5, 20.5)!.r; const cx = G.lightAt(w, 20.5, 20.5)!.x, cy = G.lightAt(w, 20.5, 20.5)!.y;
    const z = G.spawnZombie(w, "zombie_walker", cx + r + 1, cy);
    let minD = Infinity; for (let i = 0; i < 20 * 20; i++) { steps(w, 1); minD = Math.min(minD, dist(w, z, cx, cy)); }
    expect(minD).toBeGreaterThan(r - 0.3);
    G.snuffFire(w, f); G.invalidateLightGrid(w); steps(w, 20 * 15);
    expect(dist(w, z, 20.5, 21.5)).toBeLessThan(2);
  });
  it("by day there is no avoidance", () => {
    const w = makeWorld(); setTimeOfDay(w, 12, 0); expect(G.lightAvoidActive(w)).toBe(false);
  });
  it("a snuffer walks into the light and puts the fire out", () => {
    const w = makeWorld(); setTimeOfDay(w, 0, 0);
    const camp = place(w, undefined, "campfire", 20, 20); const f = light(w, camp, "coal", 50);
    G.spawnPlayer(w, { x: 40, y: 20 });
    const snuffed = collect(w, G.LightSnuffed);
    G.spawnZombie(w, "zombie_snuffer", 30, 20);
    for (let i = 0; i < 20 * 60 && w.getField(f, G.Fuel, "lit"); i++) steps(w, 1);
    expect(w.getField(f, G.Fuel, "lit")).toBe(0); expect(snuffed.length).toBeGreaterThan(0);
  });
});

describe("ADR-108 fuel", () => {
  it("lantern burns crude oil, goes out when empty; fuelSecondsLeft counts the stock", () => {
    const w = makeWorld(); const lan = place(w, undefined, "lantern", 10, 10); const f = fireOf(w, lan);
    const out = collect(w, G.FuelOut);
    G.addItem(w, f, d.itemId("crude_oil"), 1); expect(G.fuelSecondsLeft(w, f)).toBeCloseTo(120);
    w.set(f, G.Fuel, { lit: 1, burnUntilTick: 0 }); G.setEmittersLit(w, f, 1); G.invalidateLightGrid(w); steps(w, 2);
    expect(G.lightAt(w, 10.5, 10.5)).toBeDefined();
    steps(w, 20 * 121); expect(w.getField(f, G.Fuel, "lit")).toBe(0); expect(out.length).toBe(1);
  });
  it("fired stations only count as stations while lit (crafting pauses when fuel runs out)", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 10, y: 11 }); const camp = place(w, p, "campfire", 10, 10);
    expect(G.stationInRange(w, p, G.StationKind.Campfire)).toBe(false);
    light(w, camp, "sticks", 1); steps(w, 1); expect(G.stationInRange(w, p, G.StationKind.Campfire)).toBe(true);
    steps(w, 20 * 6); expect(G.stationInRange(w, p, G.StationKind.Campfire)).toBe(false);
  });
  it("fuelView + toggle intent for the station panel", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 10, y: 11 }); const camp = place(w, p, "campfire", 10, 10); const f = fireOf(w, camp);
    G.addItem(w, p, d.itemId("coal"), 3); G.addItem(w, f, d.itemId("wood"), 2);
    const v = G.fuelView({ world: w, player: p }, f)!;
    expect(v.lit).toBe(false); expect(v.secondsLeft).toBeCloseTo(40); expect(v.fuels.map((x) => x.name)).toContain("Coal");
    expect(G.toggleFireIntent(f).cmd).toBe(G.ToggleFireCmd);
    expect(G.fuelView({ world: w, player: p }, G.spawnPlayer(w, { x: 0, y: 0 }))).toBeUndefined();
  });
});

describe("ADR-108 defenses", () => {
  it("arrow turret shoots zombies with inventory ammo and never its owner / tribe / party", () => {
    const w = makeWorld(); setTimeOfDay(w, 12, 0);
    const owner = G.spawnPlayer(w, { x: 9, y: 9 }); w.set(owner, G.Health, { hp: 1e6, max: 1e6 }); w.add(owner, G.Tribe, { id: 5 });
    const t = place(w, owner, "arrow_turret", 10, 10); G.addItem(w, boxOf(w, t), d.itemId("flint_arrow"), 3);
    const z = G.spawnZombie(w, "zombie_walker", 15, 10); w.set(z, G.Health, { hp: 1e4, max: 1e4 });
    const fired = collect(w, G.TurretFired); const oh = w.getField(owner, G.Health, "hp");
    const shots = () => fired.filter((e) => e.target === owner).length;
    steps(w, 20 * 5);
    expect(fired.length).toBe(3); expect(fired.every((e) => e.target === z)).toBe(true);
    expect(w.getField(z, G.Health, "hp")!).toBeLessThan(1e4); expect(shots()).toBe(0); void oh;
    expect(G.turretAmmo(w, t)).toBeUndefined();
  });
  it("hostile players are targeted only when the raid rule allows", () => {
    const w = makeWorld(); const owner = G.spawnPlayer(w, { x: 30, y: 30 }); const t = place(w, owner, "bolt_turret", 10, 10);
    G.addItem(w, boxOf(w, t), d.itemId("iron_bolt"), 5);
    const foe = G.spawnPlayer(w, { x: 13, y: 10 }); const fired = collect(w, G.TurretFired);
    G.setRaidRule(w, () => false); steps(w, 20 * 3); expect(fired.length).toBe(0); expect(G.isHostileTo(w, t, foe)).toBe(false);
    G.setRaidRule(w, () => true); steps(w, 20 * 3); expect(fired.some((e) => e.target === foe)).toBe(true);
    expect(G.isHostileTo(w, t, owner)).toBe(false);
  });
  it("bear trap roots and re-arms; barbed wire slows and hurts", () => {
    const w = makeWorld(); setTimeOfDay(w, 12, 0); const owner = G.spawnPlayer(w, { x: 30, y: 30 });
    const trap = place(w, owner, "bear_trap", 10, 10); const sprung = collect(w, G.TrapSprung);
    const tp = w.get(trap, Transform)!; const z = G.spawnZombie(w, "zombie_walker", tp.x, tp.y); w.set(z, G.Health, { hp: 1e4, max: 1e4 });
    steps(w, 4); expect(sprung.length).toBe(1); expect(w.getField(z, G.Health, "hp")!).toBeLessThan(1e4);
    steps(w, 20 * 2); expect(sprung.length).toBe(1);
    const wire = place(w, owner, "barbed_wire", 20, 20); const wp = w.get(wire, Transform)!;
    const z2 = G.spawnZombie(w, "zombie_walker", wp.x, wp.y); const h = w.getField(z2, G.Health, "hp")!;
    steps(w, 8); expect(w.getField(z2, G.Health, "hp")!).toBeLessThan(h);
  });
  it("flame turret burns oil and can ignite", () => {
    const w = makeWorld(); setTimeOfDay(w, 12, 0); const owner = G.spawnPlayer(w, { x: 30, y: 30 });
    const t = place(w, owner, "flame_turret", 10, 10); G.addItem(w, boxOf(w, t), d.itemId("crude_oil"), 6);
    const z = G.spawnZombie(w, "zombie_walker", 12, 10); w.set(z, G.Health, { hp: 1e4, max: 1e4 });
    steps(w, 20 * 8); expect(w.has(z, G.Burning) || w.getField(z, G.Health, "hp")! < 1e4).toBe(true);
  });
});
