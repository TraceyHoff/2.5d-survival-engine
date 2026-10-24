import { describe, expect, it } from "vitest";
import { NetId, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const id = (k: string) => d.itemId(k);
let nid = 900;
const net = (w: World, e: Entity): Entity => { w.add(e, NetId, { id: ++nid }); return e; };
const player = (w: World, x = 0, y = 0): Entity => net(w, G.spawnPlayer(w, { x, y, maxWeight: 0, clientId: 1 }));
const slotOf = (w: World, p: Entity, item: number): number => { const v = G.readSlots(w, p); for (let i = 0; i < v.slotCount; i++) if (v.item(i) === item && v.count(i)) return i; return -1; };
function deploy(w: World, p: Entity): Entity {
  G.addItem(w, p, id("vehicle_kit_car_sedan"), 1, 77);
  const v = G.deployVehicleKit(w, p, slotOf(w, p, id("vehicle_kit_car_sedan")), 2, 0) as Entity; net(w, v); return v;
}

describe("ADR-109 vehicle keys", () => {
  it("deploying a crafted vehicle gives the crafter a key bound to it (code in the tooltip)", () => {
    const w = makeWorld(); const p = player(w); const v = deploy(w, p);
    const k = G.lockKeyId(w, v); expect(k).toBeGreaterThan(0);
    expect(G.keysHeld(w, p)).toEqual([k]); expect(G.hasKeyFor(w, p, v)).toBe(true);
    const tip = G.inventoryView({ world: w, player: p }).find((s) => s.item === id("vehicle_key"))!.tooltip;
    expect(tip).toContain(G.keyCode(k)); expect(G.keyCode(k)).toMatch(/^K-[0-9A-Z]{4,}$/);
    const v2 = deploy(w, p); expect(G.lockKeyId(w, v2)).not.toBe(k);
  });
  it("driver seat and engine need the key; passengers don't", () => {
    const w = makeWorld(); const owner = player(w); const v = deploy(w, owner); const other = player(w, 1, 0);
    expect(G.validateEnter(w, other, v, 0)).toBe("no_key");
    expect(G.enterVehicle(w, other, v)).toBeUndefined(); expect(w.getField(other, G.Driver, "seat")).not.toBe(0);
    expect(G.enterVehicle(w, owner, v)).toBeUndefined(); expect(w.getField(owner, G.Driver, "seat")).toBe(0);
    expect(G.setVehicleToggle(w, owner, v, G.VEHICLE_ENGINE_ON, 1)).toBeUndefined();
    // key leaves the driver's pack -> can't start the engine again
    G.setVehicleToggle(w, owner, v, G.VEHICLE_ENGINE_ON, 0);
    G.removeItem(w, owner, id("vehicle_key"), 1); expect(G.validateVehicleToggle(w, owner, v, G.VEHICLE_ENGINE_ON, 1)).toBe("no_key");
  });
  it("keys drop in the death bag, can be looted and then drive (AI humans use the same path)", () => {
    const w = makeWorld(); const owner = player(w); const v = deploy(w, owner); const bot = player(w, 1, 1);
    const bag = G.dropDeathBag(w, owner)!; expect(bag).toBeDefined(); expect(G.keysHeld(w, owner)).toEqual([]);
    const s = slotOf(w, bag, id("vehicle_key")); expect(s).toBeGreaterThanOrEqual(0);
    expect(G.moveSlotTuples(w, bag, bot, [{ slot: s, count: 1 }])).toBe(true);
    expect(G.enterVehicle(w, bot, v, 0)).toBeUndefined();
  });
  it("keys keep their binding in containers (store/trade path)", () => {
    const w = makeWorld(); const p = player(w); const v = deploy(w, p); const box = w.create(); w.add(box, G.Container, { slotCount: 4 });
    expect(G.moveSlotTuples(w, p, box, [{ slot: slotOf(w, p, id("vehicle_key")), count: 1 }])).toBe(true);
    expect(G.keysHeld(w, p)).toEqual([]);
    expect(G.listSlots(w, box).find((x) => x.item === id("vehicle_key"))!.crafterId).toBe(G.lockKeyId(w, v));
  });
  it("destroyed vehicle: key opens nothing", () => {
    const w = makeWorld(); const p = player(w); const v = deploy(w, p); const k = G.lockKeyId(w, v);
    expect(G.keyTooltip(w, k)).not.toContain("destroyed"); w.destroy(v);
    expect(G.vehicleForKey(w, k)).toBeUndefined(); expect(G.keyTooltip(w, k)).toContain("destroyed");
  });
  it("legacy vehicles: world-spawned stay open; crafted ones lock and the owner gets the key once present", () => {
    const w = makeWorld(); const open = net(w, G.spawnVehicle(w, "car_sedan", 5, 0));
    if (!w.isRegistered(PlayerId)) w.register(PlayerId);
    const old = net(w, G.spawnVehicle(w, "car_sedan", 8, 0)); w.add(old, G.VehicleCondition, { crafterId: 42, wear: 0 });
    steps(w, 21);
    expect(G.lockKeyId(w, open)).toBe(0); expect(G.hasKeyFor(w, player(w), open)).toBe(true);
    expect(G.lockKeyId(w, old)).toBeGreaterThan(0); expect(w.getField(old, G.VehicleLock, "issued")).toBe(0);
    const p = player(w); w.add(p, PlayerId, { id: 42 }); steps(w, 21);
    expect(G.keysHeld(w, p)).toEqual([G.lockKeyId(w, old)]); expect(w.getField(old, G.VehicleLock, "issued")).toBe(1);
    steps(w, 41); expect(G.keysHeld(w, p)).toHaveLength(1); // issued once
  });
});
