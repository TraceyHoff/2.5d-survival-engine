import { describe, it, expect } from "vitest";
import { NetId, Transform } from "@engine/core";
import { applyDamage, expressionKey, Expression, GAMEPLAY_COMPONENTS, GAMEPLAY_REPLICATION, hitDirRad, HitReact, NodeRegrow, spawnAnimal, spawnPlayer, spawnZombie } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

describe("ADR-134 hit reactions", () => {
  it("damage stamps HitReact with direction, attacker NetId and amount on players, animals and zombies", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 }); w.add(p, NetId, { id: 77 });
    const z = spawnZombie(w, "zombie_walker", 2, 0); const a = spawnAnimal(w, "animal_chicken", 0, 2); const o = spawnPlayer(w, { x: -2, y: 0 });
    for (const t of [z, a, o]) applyDamage(w, t, 3, p);
    const hz = w.get(z, HitReact)!; expect(hz).toMatchObject({ startTick: w.tick, src: 77, amount: 3 });
    expect(Math.cos(hitDirRad(hz.dir))).toBeCloseTo(1, 1); // pushed +x (away from the attacker)
    expect(Math.sin(hitDirRad(w.get(a, HitReact)!.dir))).toBeCloseTo(1, 1);
    expect(Math.cos(hitDirRad(w.get(o, HitReact)!.dir))).toBeCloseTo(-1, 1);
    expect(w.get(z, Transform)).toMatchObject({ x: 2, y: 0 }); // no authoritative knockback / stun
  });

  it("a fresh hit shows the hurt expression, also on zombies", () => {
    const w = makeWorld(); const p = spawnPlayer(w, { x: 0, y: 0 }); const z = spawnZombie(w, "zombie_walker", 2, 0);
    applyDamage(w, z, 1, p); steps(w, 6);
    expect(expressionKey(w.get(z, Expression)?.id ?? 0)).toBe("hurt");
  });

  it("components are appended, broadcast, HitReact not persisted, NodeRegrow persisted", () => {
    const names = GAMEPLAY_COMPONENTS.map((c) => c.name);
    expect(names.slice(-2)).toEqual(["HitReact", "NodeRegrow"]);
    expect(HitReact.persistent).toBeFalsy(); expect(NodeRegrow.persistent).toBe(true);
    const scope = (n: string) => GAMEPLAY_REPLICATION.find((r) => r.def.name === n)?.scope;
    expect(scope("HitReact")).toBe("all"); expect(scope("NodeRegrow")).toBe("all");
  });
});
