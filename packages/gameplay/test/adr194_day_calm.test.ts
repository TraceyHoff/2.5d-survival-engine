import { describe, it, expect } from "vitest";
import { setTimeOfDay, Transform, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { DamageCause, Health, HordeMember, spawnPlayer, spawnZombie, ZombieBrain, ZState } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const setup = (hours: number) => {
  const w = makeWorld(); setTimeOfDay(w, hours, 0);
  const p = spawnPlayer(w, { x: 10, y: 10 }); const z = spawnZombie(w, "zombie_walker", 13, 10);
  return { w, p, z };
};
const hunting = (w: ReturnType<typeof makeWorld>, z: Entity, p: Entity) => {
  const s = w.getField(z, ZombieBrain, "state"); return (s === ZState.Chase || s === ZState.AttackPlayer) && w.getField(z, ZombieBrain, "target") === p;
};

describe("ADR-194 zombies are calm by day, aggressive by night; no sunlight damage", () => {
  it("no daylight damage at noon in the open", () => {
    const w = makeWorld(); setTimeOfDay(w, 12, 0); spawnPlayer(w, { x: 40, y: 40 }); const z = spawnZombie(w, "zombie_walker", 30, 30);
    const hp0 = w.getField(z, Health, "hp"); steps(w, 200);
    expect(w.getField(z, Health, "hp")).toBe(hp0);
  });
  it("a day zombie ignores a nearby player (and never hurts them)", () => {
    const { w, p, z } = setup(12); const hp0 = w.getField(p, Health, "hp"); steps(w, 100);
    expect(hunting(w, z, p)).toBe(false); expect(w.getField(p, Health, "hp")).toBe(hp0);
  });
  it("a night zombie targets the player", () => {
    const { w, p, z } = setup(0); steps(w, 20); expect(hunting(w, z, p)).toBe(true);
  });
  it("a horde zombie targets the player by day", () => {
    const { w, p, z } = setup(12); const t = w.get(p, Transform)!;
    w.add(z, HordeMember, { horde: 1, target: 0 as Entity, tx: t.x, ty: t.y }); steps(w, 20);
    expect(hunting(w, z, p)).toBe(true);
  });
  it("an attacked day zombie retaliates against its attacker", () => {
    const { w, p, z } = setup(12); steps(w, 20); expect(hunting(w, z, p)).toBe(false);
    G.applyDamage(w, z, 1, p, DamageCause.Combat); steps(w, 20); expect(hunting(w, z, p)).toBe(true);
  });
  it("dusk is staggered: zombies do not all wake on the same tick", () => {
    const w = makeWorld(); const zs = Array.from({ length: 40 }, (_, i) => spawnZombie(w, "zombie_walker", 5 + i, 5));
    const ai = G.gameplayDefs(w).ai; const t = ai.aggroStartT + ai.aggroStaggerT / 2;
    const n = zs.filter((z) => G.zombieAggressive(w, z, t)).length;
    expect(n).toBeGreaterThan(0); expect(n).toBeLessThan(40);
    expect(zs.every((z) => G.zombieAggressive(w, z, ai.aggroStartT + ai.aggroStaggerT))).toBe(true);
    expect(zs.every((z) => !G.zombieAggressive(w, z, 0.5))).toBe(true);
  });
});
