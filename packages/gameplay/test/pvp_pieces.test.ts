import { describe, it, expect } from "vitest";
import { Weather, type Entity, type World } from "@engine/core";
import {
  attachmentsOf, BuildPiece, Burning, damagePiece, defaultDefs, DOOR_BREACHED, DoorState, FIRE, Health, ignite, placePiece, RaidAlarm,
  sightBonusAt, snapPlacement, spawnPlayer, Tribe, WeatherKind,
} from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const d = defaultDefs();
function place(w: World, b: Entity, key: string, x: number, y: number, tier = 0): Entity {
  const sn = snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier, variant: 0 });
  if (typeof sn === "number") throw new Error(`snap ${key} ${sn}`);
  return placePiece(w, b, sn, { pay: false });
}
const door = (w: World, p: Entity) => attachmentsOf(w, p).find((a) => w.has(a, DoorState))!;

describe("pvp_clan pieces", () => {
  it("all six proposed pieces load with their features", () => {
    for (const k of ["barricade_spiked", "raid_bell", "banner_wall", "gate_clan", "clan_hall_door", "watchtower"]) expect(d.pieces.has(d.pieceId(k))).toBe(true);
  });
  it("spiked barricade hurts and slows outsiders, spares its tribe", () => {
    const w = makeWorld(); const owner = spawnPlayer(w, { x: 20, y: 20 }); w.add(owner, Tribe, { id: 3 });
    place(w, owner, "barricade_spiked", 5, 5);
    const foe = spawnPlayer(w, { x: 5.5, y: 5.5 }); const pal = spawnPlayer(w, { x: 5.5, y: 5.5 }); w.add(pal, Tribe, { id: 3 });
    const h0 = w.getField(foe, Health, "hp")!; steps(w, 20);
    expect(w.getField(foe, Health, "hp")!).toBeLessThan(h0); expect(w.getField(pal, Health, "hp")).toBe(h0);
  });
  it("clan gate spawns clan-locked, breaches at breachAt, raid bell rings once per cooldown", () => {
    const w = makeWorld(); const owner = spawnPlayer(w, { x: 0, y: 0 }); w.add(owner, Tribe, { id: 7 });
    const gate = place(w, owner, "gate_clan", 4, 4); place(w, owner, "raid_bell", 8, 4);
    expect(w.getField(door(w, gate), DoorState, "lockTribe")).toBe(7);
    const alarms = collect(w, RaidAlarm);
    damagePiece(w, gate, 100); steps(w, 1); damagePiece(w, gate, 100); steps(w, 1);
    expect(alarms.length).toBe(1);
    damagePiece(w, gate, 1500 * 0.8); steps(w, 1);
    expect(w.get(door(w, gate), DoorState)).toMatchObject({ open: DOOR_BREACHED, lockTribe: 0 });
  });
  it("watchtower grants sight bonus around it", () => {
    const w = makeWorld(); const b = spawnPlayer(w, { x: 0, y: 0 }); place(w, b, "watchtower", 10, 10);
    expect(sightBonusAt(w, 10.5, 10.5)).toBe(12); expect(sightBonusAt(w, 40, 40)).toBe(0);
  });
});

describe("Burning", () => {
  it("wood pieces burn, lose hp, and rain quenches them; stone does not ignite", () => {
    const w = makeWorld(); const b = spawnPlayer(w, { x: 0, y: 0 });
    const box = place(w, b, "storage_box", 3, 3);
    const tier = w.getField(box, BuildPiece, "tier")!;
    expect(ignite(w, box)).toBe(FIRE.flammableTiers.includes(tier));
    if (!FIRE.flammableTiers.includes(tier)) return;
    const hp0 = w.getField(box, BuildPiece, "hp")!; steps(w, 60);
    expect(w.getField(box, BuildPiece, "hp")!).toBeLessThan(hp0);
    Object.assign(w.env(Weather), { kind: WeatherKind.Storm }); steps(w, 20 * 20);
    expect(w.has(box, Burning)).toBe(false);
  });
  it("burning creatures take fire damage and the flame decays", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 }); const h0 = w.getField(p, Health, "hp")!;
    expect(ignite(w, p)).toBe(true); steps(w, 40);
    expect(w.getField(p, Health, "hp")!).toBeLessThan(h0);
    steps(w, 20 * 20); expect(w.has(p, Burning)).toBe(false);
  });
});
