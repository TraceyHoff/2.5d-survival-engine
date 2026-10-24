/** ADR-102 gameplay pieces: O(1) NetId index, controlled chain, hitch-frame posing, view bonus, guard. */
import { describe, expect, it } from "vitest";
import { NetId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

let nid = 500;
const net = (w: World, e: Entity): Entity => { w.add(e, NetId, { id: ++nid }); return e; };
const car = (w: World, id: string, x = 0, y = 0, h = 0): Entity => net(w, G.spawnVehicle(w, id, x, y, h));
const player = (w: World, x = 0, y = 0): Entity => net(w, G.spawnPlayer(w, { x, y, maxWeight: 0, clientId: 1 }));

describe("netIdEntity (O(1) NetId map)", () => {
  it("finds spawned entities, forgets despawned ones, follows NetId changes and id reuse", () => {
    const w = makeWorld(); const a = car(w, "car_sedan"), b = car(w, "car_sedan", 5, 0);
    const ia = w.getField(a, NetId, "id")!, ib = w.getField(b, NetId, "id")!;
    expect(G.netIdEntity(w, ia)).toBe(a); expect(G.netIdEntity(w, ib)).toBe(b);
    expect(G.netIdEntity(w, 0)).toBeUndefined(); expect(G.netIdEntity(w, 999_999)).toBeUndefined();
    w.destroy(a); w.step(1 / 20); expect(G.netIdEntity(w, ia)).toBeUndefined();
    w.setField(b, NetId, "id", 77_777); G.invalidateNetIdIndex(w); expect(G.netIdEntity(w, 77_777)).toBe(b); expect(G.netIdEntity(w, ib)).toBeUndefined();
    const c = w.create(); w.add(c, NetId, { id: ia }); expect(G.netIdEntity(w, ia)).toBe(c); // id reused by a new entity
    const late = w.create(); w.step(1 / 20); expect(G.netIdEntity(w, ib)).toBeUndefined(); w.add(late, NetId, { id: 88_888 }); expect(G.netIdEntity(w, 88_888)).toBe(late); // NetId added after spawn
    expect(G.vehicleByNetId(w, 77_777)).toBe(b); expect(G.vehicleByNetId(w, ia)).toBeUndefined(); // not a vehicle
  });
  it("lookups are constant time: 5k entities, 50k hits without rebuilding", () => {
    const w = makeWorld(); const es: Entity[] = []; for (let i = 0; i < 5000; i++) { const e = w.create(); w.add(e, NetId, { id: 10_000 + i }); es.push(e); }
    G.netIdEntity(w, 10_000); // first (dirty) lookup builds once
    const t0 = performance.now(); for (let k = 0; k < 50_000; k++) { const i = k % 5000; if (G.netIdEntity(w, 10_000 + i) !== es[i]) throw new Error("miss"); }
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe("controlled chain + hitch frame", () => {
  it("seat-0 driver controls vehicle + trailer chain; passengers control nothing", () => {
    const w = makeWorld(); const p = player(w, 0, 2), q = player(w, 0, 3); const pk = car(w, "truck_pickup"); const t = car(w, "trailer_cargo_medium", -(2.9 + 2.6), 0);
    expect(G.hitchVehicles(w, p, t, pk)).toBeUndefined();
    expect(G.enterVehicle(w, p, pk, 0)).toBeUndefined(); expect(G.enterVehicle(w, q, pk, 1)).toBeUndefined();
    expect(G.controlledVehicles(w, [p])).toEqual([pk, t]); expect(G.controlledVehicles(w, [q])).toEqual([]);
  });
  it("poses a non-predicted trailer on its tow's rear pin", () => {
    const w = makeWorld(); const p = player(w, 0, 2); const pk = car(w, "truck_pickup"); const t = car(w, "trailer_cargo_medium", -(2.9 + 2.6), 0);
    expect(G.hitchVehicles(w, p, t, pk)).toBeUndefined();
    w.set(pk, Transform, { x: 10, y: 0, facing: 0 }); w.set(t, Transform, { x: -40, y: 3 }); // stale interpolated trailer
    expect(G.poseTrailersInHitchFrame(w)).toBe(1);
    const tt = w.get(t, Transform)!; expect(tt.x).toBeCloseTo(10 - (2.9 + 2.6), 1); expect(tt.y).toBeCloseTo(0, 1);
    w.predicted.add(t); w.set(t, Transform, { x: -40, y: 3 }); expect(G.poseTrailersInHitchFrame(w)).toBe(0); expect(w.get(t, Transform)!.x).toBe(-40);
  });
});

describe("vehicle guard", () => {
  it("reverts an over-speed driven vehicle and reports; parked/admin moves and allow() pass", () => {
    const w = makeWorld(); const p = player(w, 0, 2); const c = car(w, "car_sedan"); const parked = car(w, "car_sedan", 50, 50);
    const rep: G.VehicleViolation[] = []; G.installVehicleGuard(w, (v) => rep.push(v));
    expect(G.enterVehicle(w, p, c, 0)).toBeUndefined(); w.step(1 / 20);
    w.set(c, Transform, { x: 3, y: 0 }); w.set(parked, Transform, { x: 90, y: 90 }); w.step(1 / 20);
    expect(rep).toEqual([expect.objectContaining({ vehicle: c, driver: p, kind: "speed" })]);
    expect(w.get(c, Transform)!.x).toBeCloseTo(0, 3); expect(w.get(parked, Transform)!.x).toBe(90);
    w.set(c, Transform, { x: 40, y: 0 }); w.step(1 / 20); expect(rep[1]!.kind).toBe("teleport");
    const w2 = makeWorld(); const p2 = player(w2, 0, 2); const c2 = car(w2, "car_sedan"); const rep2: unknown[] = [];
    G.installVehicleGuard(w2, (v) => rep2.push(v), { allow: () => true }); G.enterVehicle(w2, p2, c2, 0); w2.step(1 / 20);
    w2.set(c2, Transform, { x: 40, y: 0 }); w2.step(1 / 20); expect(rep2).toEqual([]);
  });
});
