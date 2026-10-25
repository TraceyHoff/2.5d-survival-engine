import { describe, expect, it } from "vitest";
import { NetId, World } from "@engine/core";
import { applyDamage, defaultDefs, GroupSummary, installGameplay, spawnAnimal, spawnPlayer, spawnZombie } from "@engine/gameplay";
import { barFill, COMBAT_TARGET_MS, CREATURE_BAR_MS, creatureBarAlpha, CreatureBars } from "../src/gather-fx.js";
import { HIT_REACT_MS, hitPose } from "../src/view.js";

const mk = () => { const w = new World({ seed: 1, maxEntities: 1024 }); installGameplay(w, { defs: defaultDefs() } as never); return w; };
describe("ADR-134 hit reactions + creature bars (client)", () => {
  it("flinch pose: nudge away from the hit, squash, tilt and an early flash, then done", () => {
    const p = hitPose(60, 0)!; expect(p.dx).toBeGreaterThan(0.05); expect(Math.abs(p.dy)).toBeLessThan(1e-9);
    expect(p.flash).toBeGreaterThan(0.4); expect(p.tilt).not.toBe(0);
    expect(hitPose(200, 0)!.flash).toBe(0); expect(hitPose(HIT_REACT_MS + 1, 0)).toBeUndefined(); expect(hitPose(-5, 0)).toBeUndefined();
    expect(hitPose(30, Math.PI / 2)!.dy).toBeGreaterThan(0);
  });
  it("bars appear on hit for zombies, animals and other players, fade after ~4 s; own targets stay up", () => {
    const w = mk(); const me = spawnPlayer(w, { x: 0, y: 0 }); w.add(me, NetId, { id: 5 });
    const z = spawnZombie(w, "zombie_walker", 2, 0); const a = spawnAnimal(w, "animal_chicken", 0, 2); const o = spawnPlayer(w, { x: -2, y: 0 });
    const cb = new CreatureBars(); expect(cb.scan(w, 0, me)).toEqual([]);
    applyDamage(w, z, 5, me); applyDamage(w, a, 1, o); applyDamage(w, o, 5, z);
    const bars = cb.scan(w, 100, me); expect(bars.map((b) => b.kind).sort()).toEqual(["animal", "human", "zombie"]);
    expect(cb.bars.get(z)!.target).toBe(true); expect(cb.bars.get(a)!.target).toBe(false);
    cb.scan(w, 100 + CREATURE_BAR_MS + 1, me);
    expect(cb.bars.has(a)).toBe(false); expect(cb.bars.has(z)).toBe(true); // still my combat target
    cb.scan(w, 100 + COMBAT_TARGET_MS + 1, me); expect(cb.bars.has(z)).toBe(false);
    expect(creatureBarAlpha(CREATURE_BAR_MS - 100, false)).toBeGreaterThan(0); expect(creatureBarAlpha(1e9, true)).toBe(1);
  });
  it("party / clan mates draw blue", () => {
    const w = mk(); const me = spawnPlayer(w, { x: 0, y: 0 }); const mate = spawnPlayer(w, { x: 1, y: 0 });
    for (const e of [me, mate]) w.add(e, GroupSummary, { partyId: 0, clanId: 9, rank: 0 });
    const cb = new CreatureBars(); cb.scan(w, 0, me); applyDamage(w, mate, 2, mate); cb.scan(w, 10, me);
    expect(cb.bars.get(mate)!.ally).toBe(true); expect(barFill(1, true)).toBe("#6CA8E6"); expect(barFill(0.1)).toBe("#C0584A");
  });
});
