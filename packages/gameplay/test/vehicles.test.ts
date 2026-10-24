import { describe, expect, it } from "vitest";
import { applySnapshot, CommandRegistry, CommandRejected, decodeSnapshot, encodeSnapshot, installCommandHandlers, NetId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import raw from "../data/vehicles.json";
import { makeWorld, steps } from "./helpers.js";

let nid = 100;
const net = (w: World, e: Entity): Entity => { w.add(e, NetId, { id: ++nid }); return e; };
const player = (w: World, x = 0, y = 0): Entity => net(w, G.spawnPlayer(w, { x, y, maxWeight: 0, clientId: 1 }));
const car = (w: World, id: string, x = 0, y = 0, h = 0): Entity => net(w, G.spawnVehicle(w, id, x, y, h));
const drive = (w: World, p: Entity, x: number, y: number, boost = false, n = 1): void => { for (let i = 0; i < n; i++) { G.setDriveInput(w, p, x, y, boost); w.step(1 / 20); } };

describe("vehicle defs", () => {
  it("data validates; covers every class; bicycles use stamina, motors fuel", () => {
    expect(G.validateVehicleDefs(G.VEHICLE_DEFS)).toEqual([]);
    for (const c of G.VEHICLE_CLASSES) expect(G.VEHICLE_DEFS.some((d) => d.class === c)).toBe(true);
    expect(G.VEHICLE_DEFS.filter((d) => d.class === "bicycle").length).toBeGreaterThanOrEqual(6);
    for (const d of G.VEHICLE_DEFS) if (d.class === "bicycle") { expect(d.fuel).toBeNull(); expect(d.stamina).not.toBeNull(); }
    const bad = structuredClone(raw) as { vehicles: G.VehicleDef[] }; bad.vehicles[0]!.fuel = { capacity: 1, perSecond: 1 }; bad.vehicles[1]!.interior.stations = ["nope"];
    expect(() => G.loadVehicleDefs(bad)).toThrow(/stamina.*unknown station|unknown station/);
  });
  it("storage capacity scales with size", () => {
    const rank = (s: G.VehicleSize) => G.VEHICLE_SIZES.indexOf(s);
    const avg = (s: G.VehicleSize) => { const ds = G.VEHICLE_DEFS.filter((d) => d.size === s); return ds.reduce((a, d) => a + G.storageCapacity(d).maxWeight, 0) / ds.length; };
    for (let i = 1; i < G.VEHICLE_SIZES.length; i++) expect(avg(G.VEHICLE_SIZES[i]!)).toBeGreaterThan(avg(G.VEHICLE_SIZES[i - 1]!));
    const w = makeWorld(); const b = G.spawnVehicle(w, "bike_basic", 0, 0), s = G.spawnVehicle(w, "semi_trailer_box", 5, 5);
    expect(w.get(b, G.Container)!.slotCount).toBeLessThan(w.get(s, G.Container)!.slotCount);
    expect(w.get(s, G.Container)!.slotCount).toBeLessThanOrEqual(G.CONTAINER_SLOTS);
    expect(rank("xl")).toBe(4);
  });
});

describe("vehicle components", () => {
  it("appended at the end of the component order", () => {
    const L = G.GAMEPLAY_COMPONENTS; const i = L.indexOf(G.ClanStatus);
    expect([L[i + 1], L[i + 2], L[i + 3], L[i + 4]]).toEqual([G.Vehicle, G.VehicleSeats, G.Driver, G.Hitch]); expect(L.length).toBeGreaterThanOrEqual(i + 5); expect(L.indexOf(G.VehicleCondition)).toBeGreaterThan(L.indexOf(G.ExplosiveOwner)); // later slices append after vehicles
  });
  it("serialization round trip", () => {
    const w = makeWorld(); const p = player(w); const v = car(w, "truck_pickup", 1, 0); const t = car(w, "trailer_cargo_medium", -3.5, 0);
    expect(G.enterVehicle(w, p, v)).toBeUndefined(); expect(G.hitchVehicles(w, p, t, v)).toBeUndefined(); drive(w, p, 1, 0.3, false, 20);
    const w2 = makeWorld(); G.spawnPlayer(w2, { x: 0, y: 0, maxWeight: 0 }); G.spawnVehicle(w2, "truck_pickup", 0, 0); G.spawnVehicle(w2, "trailer_cargo_medium", 0, 0); applySnapshot(w2, decodeSnapshot(w2, encodeSnapshot(w, { all: true })));
    for (const e of [v, t]) { expect(w2.get(e, G.Vehicle)).toEqual(w.get(e, G.Vehicle)); expect(w2.get(e, G.Hitch)).toEqual(w.get(e, G.Hitch)); }
    expect(w2.get(p, G.Driver)).toEqual(w.get(p, G.Driver)); expect(w2.get(v, G.VehicleSeats)).toEqual(w.get(v, G.VehicleSeats));
  });
});

describe("vehicle physics", () => {
  const run = (): number[] => {
    nid = 100; const w = makeWorld(); const p = player(w); const v = car(w, "car_muscle"); const t = car(w, "trailer_utility_small", -3.3, 0);
    G.enterVehicle(w, p, v); // car_muscle has no rear hitch -> use offroad for trailer
    const o = car(w, "car_offroad", 0, 10); const q = player(w, 0, 10); G.enterVehicle(w, q, o);
    const t2 = car(w, "trailer_utility_small", -3.65, 10); expect(G.hitchVehicles(w, q, t2, o)).toBeUndefined(); void t;
    for (let i = 0; i < 200; i++) { G.setDriveInput(w, p, Math.cos(i / 30), Math.sin(i / 30), i % 50 > 25); G.setDriveInput(w, q, Math.cos(i / 20), Math.sin(i / 20), false); w.step(1 / 20); }
    return [v, o, t2, p].flatMap((e) => { const x = w.get(e, Transform)!; return [x.x, x.y, x.facing]; });
  };
  it("is deterministic", () => { const a = run(), b = run(); expect(a).toEqual(b); expect(a.every(Number.isFinite)).toBe(true); });
  it("accelerates to ~maxSpeed, boosts, consumes fuel, and rider follows", () => {
    const w = makeWorld(); const p = player(w); const v = car(w, "car_sedan"); G.enterVehicle(w, p, v);
    const d = G.vehicleDefOf(w, v)!; drive(w, p, 1, 0, false, 120);
    expect(w.get(v, G.Vehicle)!.speed).toBeCloseTo(d.maxSpeed, 0); expect(w.get(v, G.Vehicle)!.fuel).toBeLessThan(d.fuel!.capacity);
    expect(w.get(p, Transform)!.x).toBeCloseTo(w.get(v, Transform)!.x, 5);
    drive(w, p, 1, 0, true, 60); expect(w.get(v, G.Vehicle)!.speed).toBeGreaterThan(d.maxSpeed * 1.1);
    drive(w, p, 0, 0, false, 400); expect(w.get(v, G.Vehicle)!.speed).toBe(0);
  });
  it("turns with drift; bicycles drain stamina instead of fuel", () => {
    const w = makeWorld(); const p = player(w); const v = car(w, "bike_bmx"); G.enterVehicle(w, p, v);
    const s0 = w.get(p, G.Survival)!.stamina; drive(w, p, 1, 0, false, 40); drive(w, p, 0, 1, true, 10);
    expect(w.get(p, G.Survival)!.stamina).toBeLessThan(s0); expect(w.get(v, G.Vehicle)!.heading).toBeGreaterThan(0.1); expect(w.get(v, G.Vehicle)!.drift).not.toBe(0);
  });
  it("collides with world colliders", () => {
    const w = makeWorld(); G.setVehicleBlocker(w, (_w, _a, _b, x) => x >= 10);
    const p = player(w); const v = car(w, "car_compact"); G.enterVehicle(w, p, v); drive(w, p, 1, 0, false, 200);
    const x = w.get(v, Transform)!.x; expect(x + 1.8).toBeLessThan(10); expect(x).toBeGreaterThan(6);
    expect(w.get(v, G.Vehicle)!.health).toBeLessThan(G.vehicleDefOf(w, v)!.health);
  });
  it("trailer follows the tow hitch (pin joint) and articulates", () => {
    const w = makeWorld(); const p = player(w); const v = car(w, "truck_pickup"); const td = G.vehicleDefOf(w, v)!;
    const tr = car(w, "trailer_flatbed_large", -(td.footprint.length / 2 + 0.2) - 3.6, 0); G.enterVehicle(w, p, v);
    expect(G.hitchVehicles(w, p, tr, v)).toBeUndefined(); drive(w, p, 1, 0, false, 60); drive(w, p, 0, 1, false, 15);
    const vt = w.get(v, Transform)!, vh = w.get(v, G.Vehicle)!.heading, tt = w.get(tr, Transform)!, th = w.get(tr, G.Vehicle)!.heading;
    const pin = G.hitchPoint(td, "rear", vt.x, vt.y, vh)!, front = G.hitchPoint(G.vehicleDefOf(w, tr)!, "front", tt.x, tt.y, th)!;
    expect(Math.hypot(pin.x - front.x, pin.y - front.y)).toBeLessThan(1e-3);
    expect(Math.abs(vh - th)).toBeGreaterThan(0.05); expect(tt.x).toBeGreaterThan(0);
  });
});

describe("enter/exit + hitch validation", () => {
  it("validates enter/exit", () => {
    const w = makeWorld(); const p = player(w); const q = player(w, 1, 0); const far = player(w, 50, 50); const b = car(w, "bike_road");
    expect(G.validateEnter(w, far, b, 255)).toBe("too_far");
    expect(G.validateEnter(w, p, b, 3)).toBe("bad_seat");
    expect(G.enterVehicle(w, p, b)).toBeUndefined(); expect(G.validateEnter(w, q, b, 255)).toBe("full"); expect(G.validateEnter(w, p, b, 255)).toBe("already_riding");
    const tr = car(w, "trailer_cargo_medium", 3, 3); expect(G.validateEnter(w, q, tr, 255)).toBe("no_seats");
    expect(G.exitVehicle(w, p)).toBeUndefined(); expect(w.has(p, G.Driver)).toBe(false); expect(Array.from(w.get(b, G.VehicleSeats)!.occupant as ArrayLike<number>)[0]).toBe(0);
    expect(G.exitVehicle(w, p)).toBe("not_riding");
    expect(G.vehicleInteractCommand(w, p, b)!.def).toBe(G.VehicleEnterCmd);
  });
  it("commands go through CommandHandlers with rejection reasons", () => {
    const w = makeWorld(); const p = player(w); const v = car(w, "van_passenger", 1, 0); const far = car(w, "car_sedan", 40, 0);
    const reg = G.registerGameplayCommands(new CommandRegistry()); const h = installCommandHandlers(w, reg); G.installVehicleCommands(w, h);
    const rej: string[] = []; w.events.on(CommandRejected, (e) => rej.push(e.reason));
    h.enqueue(p, 1, 1, reg.make(G.VehicleEnterCmd, { target: far, seat: 255 })); w.step(1 / 20); expect(rej).toEqual(["too_far"]);
    h.enqueue(p, 1, 2, reg.make(G.VehicleEnterCmd, { target: v, seat: 2 })); w.step(1 / 20); expect(w.get(p, G.Driver)!.seat).toBe(2);
    h.enqueue(p, 1, 3, reg.make(G.VehicleExitCmd, {})); w.step(1 / 20); expect(w.has(p, G.Driver)).toBe(false);
    h.enqueue(p, 1, 4, reg.make(G.VehicleExitCmd, {})); w.step(1 / 20); expect(rej).toEqual(["too_far", "not_riding"]);
    expect(G.COMMAND_ENTITY_FIELDS["gameplay.vehicleHitch"]).toEqual(["target", "tow"]);
  });
  it("hitch/unhitch rules: allowlist, range, busy, cycle, parked", () => {
    const w = makeWorld(); const p = player(w, 0, 2); const pk = car(w, "truck_pickup"); const semiT = car(w, "semi_trailer_box", -10, 0);
    expect(G.validateHitch(w, p, semiT, pk)).toBe("incompatible");
    const sedan = car(w, "car_sedan", 0, 20); const tr = car(w, "trailer_utility_small", -4, 20); expect(G.validateHitch(w, p, tr, sedan)).toBe("no_hitch");
    const t1 = car(w, "trailer_cargo_medium", -30, 0); expect(G.validateHitch(w, p, t1, pk)).toBe("too_far");
    const t2 = car(w, "trailer_cargo_medium", -(2.9 + 2.6), 0); expect(G.hitchVehicles(w, p, t2, pk)).toBeUndefined();
    expect(G.validateHitch(w, p, t2, pk)).toBe("already_hitched");
    const t3 = car(w, "trailer_cargo_medium", -(2.9 + 2.6), 0.5); expect(G.validateHitch(w, p, t3, pk)).toBe("tow_busy");
    const s = car(w, "semi_tractor", 0, -20); const sb = car(w, "semi_trailer_box", -(1.2 + 7.1), -20); expect(G.hitchVehicles(w, p, sb, s)).toBe("actor_too_far");
    const q = player(w, 0, -20); expect(G.hitchVehicles(w, q, sb, s)).toBeUndefined();
    w.setField(pk, G.Vehicle, "speed", 5); expect(G.unhitchVehicle(w, p, t2)).toBe("moving"); w.setField(pk, G.Vehicle, "speed", 0);
    expect(G.unhitchVehicle(w, p, t2)).toBeUndefined(); expect(w.get(pk, G.Hitch)!.towNetId).toBe(0); expect(w.get(t2, G.Hitch)!.parentNetId).toBe(0);
    expect(G.unhitchVehicle(w, p, t2)).toBe("not_hitched");
  });
});

describe("camper interior", () => {
  it("stations usable only while parked, hooks fire", () => {
    const w = makeWorld(); const p = player(w); const c = car(w, "camper_rv"); const used: string[] = [];
    G.addVehicleStationHook(w, { name: "t", onUse: (_w, _p, _v, s) => used.push(s.key) });
    expect(G.usableVehicleStations(w, p, c).map((s) => s.key)).toEqual(["campfire", "workbench", "furnace"]);
    expect(G.nearbyVehicleStationKinds(w, p).has(1)).toBe(true);
    expect(G.useVehicleStation(w, p, c, 1)).toBeUndefined(); expect(used).toEqual(["workbench"]);
    w.setField(c, G.Vehicle, "speed", 3); expect(G.useVehicleStation(w, p, c, 1)).toBe("moving"); expect(G.usableVehicleStations(w, p, c)).toEqual([]);
    expect(G.useVehicleStation(w, p, car(w, "car_sedan", 2, 2), 0)).toBe("no_station");
  });
});

describe("drive input path", () => {
  it("analog moveX/moveY + Sprint from an InputFrame drive the vehicle (bots and devices alike)", () => {
    const w = makeWorld(); const p = player(w); const v = car(w, "car_compact"); G.enterVehicle(w, p, v);
    const reg = G.registerGameplayCommands(new CommandRegistry());
    for (let i = 0; i < 40; i++) { G.applyGameplayInput(w, p, { tick: w.tick, actions: G.GameplayActions.Sprint, moveX: 0, moveY: 1, commands: [] } as unknown as Parameters<typeof G.applyGameplayInput>[2], reg); w.step(1 / 20); }
    expect(w.get(v, Transform)!.y).toBeGreaterThan(1); expect(w.get(p, G.PlayerIntent)!.moving).toBe(0);
    const d = G.driveFromBits(G.GameplayActions.MoveRight); expect(d.x).toBeCloseTo(Math.SQRT1_2); expect(d.y).toBeCloseTo(-Math.SQRT1_2); expect(d.boost).toBe(false);
  });
});
