import { describe, it, expect } from "vitest";
import { Anim, AnimState, applyDamage, DamageCause, HitReact, spawnPlayer, spawnZombie } from "../src/index.js";
import { makeWorld } from "./helpers.js";
import type { Entity } from "@engine/core";

describe("ADR-193 no invisible attackers", () => {
  it("sunlight burns a zombie without a Hurt flinch; the HitReact says why (undirected, cause Sunlight)", () => {
    const w = makeWorld(); const z = spawnZombie(w, "zombie_walker", 10, 10);
    const a0 = w.getField(z, AnimState, "anim");
    applyDamage(w, z, 2, 0 as Entity, DamageCause.Sunlight);
    expect(w.getField(z, AnimState, "anim")).toBe(a0);
    expect(w.getField(z, AnimState, "anim")).not.toBe(Anim.Hurt);
    expect(w.get(z, HitReact)).toMatchObject({ src: 0, cause: DamageCause.Sunlight });
  });
  it("a real attacker still flinches the zombie and is named in the HitReact", () => {
    const w = makeWorld(); const z = spawnZombie(w, "zombie_walker", 10, 10); const p = spawnPlayer(w, { x: 9, y: 10 });
    applyDamage(w, z, 2, p, DamageCause.Combat);
    expect(w.getField(z, AnimState, "anim")).toBe(Anim.Hurt);
    expect(w.getField(z, HitReact, "cause")).toBe(DamageCause.Combat);
  });
});
