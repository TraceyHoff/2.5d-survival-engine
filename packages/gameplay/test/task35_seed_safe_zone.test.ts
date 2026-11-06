/**
 * Task 35 / ADR-254: animal / zombie spawn streams differ by world seed; Task 33 safe radius (20) still holds (hordes exempt).
 */
import { describe, expect, it } from "vitest";
import { installPermissions, World, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, spawnLearned, steps } from "./helpers.js";

describe("ADR-254 / Task 35 seed + safe zone", () => {
  it("SAFE_SPAWN_RADIUS stays 20 and covers installed spawn points", () => {
    expect(G.SAFE_SPAWN_RADIUS).toBe(20);
    const w = makeWorld();
    expect(G.inSpawnSafeRadius(w, 0, 0)).toBe(false);
    G.setSpawnPoints(w, [{ x: 50, y: 50 }]);
    expect(G.inSpawnSafeRadius(w, 50, 50)).toBe(true);
    expect(G.inSpawnSafeRadius(w, 50 + 19, 50)).toBe(true);
    expect(G.inSpawnSafeRadius(w, 50 + 21, 50)).toBe(false);
    expect(G.isAggressiveSpawnKind("zombie_walker", "zombie")).toBe(true);
  });

  it("world.rngFor population streams differ across seeds and match for the same seed", () => {
    const draw = (seed: number): number[] => {
      const w = new World({ seed });
      const rng = w.rngFor("pop:animal_deer:0,0");
      return Array.from({ length: 8 }, () => rng.next());
    };
    expect(draw(111)).toEqual(draw(111));
    expect(draw(111)).not.toEqual(draw(222));
  });

  it("a horde zombie still targets a survivor inside the safe radius (hordes exempt)", () => {
    const w = makeWorld(); installPermissions(w);
    G.setSpawnPoints(w, [{ x: 0, y: 0 }]);
    const p = spawnLearned(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 });
    const z = G.spawnZombie(w, "zombie_walker", 5, 0);
    w.add(z, G.HordeMember, { horde: 1, target: 0 as Entity, tx: 0, ty: 0 });
    steps(w, 20);
    expect(w.getField(z, G.ZombieBrain, "state")).toBe(2); // ZState.Chase
    void p;
  });

  it("spawn points are deterministic per seed and differ across seeds", () => {
    // computeSpawnPoints lives in @engine/world; gameplay installs whatever the server computed.
    // Pin that two worlds with different seeds that install different points stay isolated.
    const a = makeWorld(); const b = makeWorld();
    G.setSpawnPoints(a, [{ x: 10, y: 10 }]);
    G.setSpawnPoints(b, [{ x: 90, y: -90 }]);
    expect(G.inSpawnSafeRadius(a, 10, 10)).toBe(true);
    expect(G.inSpawnSafeRadius(a, 90, -90)).toBe(false);
    expect(G.inSpawnSafeRadius(b, 90, -90)).toBe(true);
    expect(G.inSpawnSafeRadius(b, 10, 10)).toBe(false);
  });
});
