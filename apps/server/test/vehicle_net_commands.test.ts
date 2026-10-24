/** Vehicle command wiring over the wire (ADR-102 + gameplay DESIGN §31): applies once, AOI-validated targets, rates. */
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 30_000 });
import { Transform, World, type Entity } from "@engine/core";
import {
  addItem, countItem, defaultDefs, Hitch, readSlots, setVehicleBlocker, spawnVehicle, netIdEntity, Driver, Vehicle,
  VehicleEnterCmd, VehicleExitCmd, VehicleHitchCmd, VehicleUnhitchCmd, VehicleStationCmd, VehicleDeployCmd, VehicleRefuelCmd, VehicleRepairCmd,
  VehicleDeployed, VehicleRefueled, VehicleRepaired, VehicleStationOpened, VEHICLE_COMMANDS, VEHICLE_CRAFT_COMMANDS, vehicleDefOf,
} from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyDemoInput, installDemoWorld, gameplayNet, onGameplayRejected, DEMO_COMMANDS, DEMO_EVENTS, INPUT_ENTITY_FIELDS, VEHICLE_CLIENT_OPTIONS, type GameplayRejection } from "../src/main.js";

const defs = defaultDefs(); const item = (k: string): number => defs.itemId(k);

async function setup() {
  const net = new LoopbackNetwork(7);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5, population: false });
  setVehicleBlocker(gs.world, () => false);
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const world = new World({ seed: 1 }); installDemoWorld(world, "client"); setVehicleBlocker(world, () => false);
  const c = new NetClient({ world, transport: net.createClient({}), commands: DEMO_COMMANDS, events: DEMO_EVENTS,
    sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyDemoInput(w, e, cmd), ...VEHICLE_CLIENT_OPTIONS });
  const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); for (let t = 0; t < 40; t++) { net.advance(50); await Promise.resolve(); } await p; clients.push(c);
  c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
  const e = gs.players.get(c.clientId!)!.entity;
  const rej: GameplayRejection[] = []; onGameplayRejected(c, (r) => rej.push(r));
  const anomalies: string[] = []; gs.net.onAnomaly((s, k) => { if (s.clientId === c.clientId) anomalies.push(k); });
  const w = gs.world;
  const vehicle = (key: string, x: number, y: number): { v: Entity; id: number } => { const v = spawnVehicle(w, key, x, y, 0); return { v, id: gs.net.netIds.netIdOf(v) ?? gs.net.netIds.assign(v) }; };
  const L = (id: number): number => { const le = netIdEntity(c.world, id); if (le === undefined) throw new Error(`client lacks ${id}`); return le; };
  const count = <T,>(t: Parameters<typeof w.events.on>[0]): T[] => { const out: T[] = []; w.events.on(t as never, (x: T) => out.push(x)); return out; };
  const slotOf = (it: number): number => { const v = readSlots(w, e); for (let i = 0; i < v.slotCount; i++) if (v.item(i) === it && v.count(i)) return i; return -1; };
  return { gs, w, c, e, rej, anomalies, tick, vehicle, L, count, slotOf, pos: () => w.get(e, Transform)! };
}

describe("vehicle commands over the wire", () => {
  it("each of the 8 commands applies exactly once", async () => {
    const s = await setup(); const p = s.pos();
    const car = s.vehicle("car_sedan", p.x + 1.5, p.y); const truck = s.vehicle("truck_pickup", p.x + 1, p.y - 4); const trailer = s.vehicle("trailer_cargo_medium", p.x + 1 - 4.5, p.y - 4);
    const camper = s.vehicle("camper_van", p.x, p.y + 3); s.tick(6);
    const send = (def: Parameters<typeof gameplayNet>[0], v: object): void => { expect(s.c.sendCommand(gameplayNet(def), v as never)).toBe(true); s.tick(6); };
    // enter / exit
    send(VehicleEnterCmd, { target: s.L(car.id), seat: 0 }); expect(s.w.get(s.e, Driver)?.seat).toBe(0);
    send(VehicleExitCmd, {}); expect(s.w.has(s.e, Driver)).toBe(false);
    // hitch / unhitch
    send(VehicleHitchCmd, { target: s.L(trailer.id), tow: s.L(truck.id) }); expect(s.rej).toEqual([]); expect(s.w.getField(trailer.v, Hitch, "parentNetId")).toBe(truck.id);
    send(VehicleUnhitchCmd, { target: s.L(trailer.id) }); expect(s.w.getField(trailer.v, Hitch, "parentNetId") ?? 0).toBe(0);
    // station
    const opened = s.count(VehicleStationOpened); send(VehicleStationCmd, { target: s.L(camper.id), station: 0 }); expect(opened).toHaveLength(1);
    // deploy
    const deployed = s.count(VehicleDeployed); const kit = item("vehicle_kit_bike_basic"); addItem(s.w, s.e, kit, 2); s.tick(2);
    send(VehicleDeployCmd, { slot: s.slotOf(kit), x: s.pos().x + 2, y: s.pos().y - 2, heading: 0 });
    expect(deployed).toHaveLength(1); expect(countItem(s.w, s.e, kit)).toBe(1);
    // refuel
    s.w.setField(car.v, Vehicle, "fuel", 0); const refueled = s.count(VehicleRefueled); const gas = item("gasoline"); addItem(s.w, s.e, gas, 5); s.tick(2);
    send(VehicleRefuelCmd, { target: s.L(car.id), slot: s.slotOf(gas), count: 2 });
    expect(refueled).toHaveLength(1); expect(countItem(s.w, s.e, gas)).toBe(3);
    // repair
    const max = vehicleDefOf(s.w, car.v)!.health; s.w.setField(car.v, Vehicle, "health", max * 0.2);
    const repaired = s.count(VehicleRepaired); const rk = item("repair_kit"); addItem(s.w, s.e, rk, 1); s.tick(2);
    send(VehicleRepairCmd, { target: s.L(car.id), slot: s.slotOf(rk) });
    expect(repaired).toHaveLength(1); expect(s.w.getField(car.v, Vehicle, "health")).toBeGreaterThan(max * 0.2);
    expect(s.rej).toEqual([]); expect(s.anomalies).toEqual([]);
  });
  it("targets outside the client's view are dropped (badEntityRef) for every targeted command", async () => {
    const s = await setup(); const p = s.pos(); const far = s.vehicle("car_sedan", p.x + 400, p.y + 400); const near = s.vehicle("car_sedan", p.x + 1.5, p.y); s.tick(8);
    expect(netIdEntity(s.c.world, far.id)).toBeUndefined();
    const forged = s.c.world.create(); (s.c as unknown as { netOf: Map<number, number> }).netOf.set(forged, far.id);
    const fuelBefore = s.w.getField(far.v, Vehicle, "fuel");
    const cases: [Parameters<typeof gameplayNet>[0], object][] = [
      [VehicleEnterCmd, { target: forged, seat: 0 }], [VehicleHitchCmd, { target: forged, tow: s.L(near.id) }], [VehicleUnhitchCmd, { target: forged }],
      [VehicleStationCmd, { target: forged, station: 0 }], [VehicleRefuelCmd, { target: forged, slot: 0, count: 1 }], [VehicleRepairCmd, { target: forged, slot: 0 }],
    ];
    for (const [def, v] of cases) { const n = s.anomalies.filter((k) => k === "badEntityRef").length; s.c.sendCommand(gameplayNet(def), v as never); s.tick(4);
      expect(s.anomalies.filter((k) => k === "badEntityRef").length, def.name).toBe(n + 1); }
    expect(s.rej).toEqual([]); expect(s.w.has(s.e, Driver)).toBe(false); expect(s.w.getField(far.v, Vehicle, "fuel")).toBe(fuelBefore);
    for (const d of [...VEHICLE_COMMANDS, ...VEHICLE_CRAFT_COMMANDS]) expect(gameplayNet(d).entityFields).toEqual([...(INPUT_ENTITY_FIELDS[d.name] ?? [])]);
  });
  it("rates: seat/hitch/station 4/s burst 8, deploy/refuel/repair 2/s burst 4, and spam is limited", async () => {
    for (const d of VEHICLE_COMMANDS) expect(gameplayNet(d).rate, d.name).toEqual({ perSec: 4, burst: 8 });
    for (const d of VEHICLE_CRAFT_COMMANDS) expect(gameplayNet(d).rate, d.name).toEqual({ perSec: 2, burst: 4 });
    const s = await setup(); const p = s.pos(); const car = s.vehicle("car_sedan", p.x + 1.5, p.y); s.tick(6);
    s.w.setField(car.v, Vehicle, "fuel", 0); const gas = item("gasoline"); addItem(s.w, s.e, gas, 20); s.tick(2);
    const refueled = s.count(VehicleRefueled);
    for (let i = 0; i < 12; i++) s.c.sendCommand(gameplayNet(VehicleRefuelCmd), { target: s.L(car.id), slot: s.slotOf(gas), count: 1 } as never);
    s.tick(4);
    expect(s.anomalies).toContain("rateLimited"); expect(refueled.length).toBeGreaterThanOrEqual(4); expect(refueled.length).toBeLessThanOrEqual(5);
    const exits0 = s.anomalies.filter((k) => k === "rateLimited").length;
    for (let i = 0; i < 16; i++) s.c.sendCommand(gameplayNet(VehicleExitCmd), {} as never);
    s.tick(4);
    expect(s.anomalies.filter((k) => k === "rateLimited").length).toBeGreaterThan(exits0);
    expect(s.rej.filter((r) => r.reason === "not_riding").length).toBeGreaterThanOrEqual(8); expect(s.rej.filter((r) => r.reason === "not_riding").length).toBeLessThanOrEqual(9);
  });
});
