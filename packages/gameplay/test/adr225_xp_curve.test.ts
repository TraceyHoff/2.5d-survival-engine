import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

/** ADR-225: slower skill-tree leveling (modelled play session) + one gather award per swing. */
const mk = (w: World, pid: number) => { const p = G.spawnPlayer(w, { x: 0, y: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }); G.migrateProgression(w, p); return p; };
const NEW = G.SKILLS.treeLevels;
const fmt = (m: number) => (m < 60 ? `${m.toFixed(1)}m` : `${(m / 60).toFixed(1)}h`);

describe("ADR-225 tree XP curve", () => {
  it("modelled normal play: level 2 inside the first session, 3-4 after an hour, 7 after several hours (old curve: minutes)", () => {
    const rows: string[] = [];
    for (const p of G.PLAY_PROFILES) {
      const oldR = G.xpPerMinute(p, true), newR = G.xpPerMinute(p, false);
      const o = G.minutesToLevels(oldR, G.OLD_TREE_CURVE), n = G.minutesToLevels(newR, NEW);
      rows.push(`${p.tree.padEnd(9)} old ${oldR.toFixed(0)}xp/m L2 ${fmt(o[0]!)} L4 ${fmt(o[2]!)} L7 ${fmt(o[5]!)} L10 ${fmt(o[8]!)} | new ${newR.toFixed(0)}xp/m L2 ${fmt(n[0]!)} L4 ${fmt(n[2]!)} L7 ${fmt(n[5]!)} L10 ${fmt(n[8]!)} | 1h: old L${G.levelAfter(oldR, G.OLD_TREE_CURVE, 60)} new L${G.levelAfter(newR, NEW, 60)}`);
      expect(n[0]!).toBeLessThan(10); // ADR-221 unlock nodes (cost 1 = level 2) stay first-session affordable
      expect(G.levelAfter(newR, NEW, 60)).toBeGreaterThanOrEqual(3); expect(G.levelAfter(newR, NEW, 60)).toBeLessThanOrEqual(4);
      expect(n[5]! / 60).toBeGreaterThanOrEqual(3); expect(n[5]! / 60).toBeLessThanOrEqual(7);
      expect(o[5]!).toBeLessThan(60); // documents the old problem
    }
    console.log(["ADR-225 time-to-level (modelled):", ...rows].join("\n"));
  });
  it("curve: early table then geometric; monotonic", () => {
    expect(G.treeXpToNext(1)).toBe(150); expect(G.treeXpToNext(6)).toBe(2100); expect(G.treeXpToNext(7)).toBe(Math.round(2100 * NEW.growth));
    for (let l = 1; l < NEW.maxLevel; l++) expect(G.treeXpToNext(l + 1)).toBeGreaterThanOrEqual(G.treeXpToNext(l));
  });
  it("one gather swing = one award, regardless of how many yield lines / items it dropped", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1); const ti = G.treeIndex("survival");
    const node = w.create();
    G.emit(w, G.ItemGathered, { entity: a, node, item: 1, count: 5 }); G.emit(w, G.ItemGathered, { entity: a, node, item: 2, count: 1 }); steps(w, 1);
    expect(G.treesOf(w, a)![ti]!.xp).toBe(G.XP.sources.gather);
    G.emit(w, G.ItemGathered, { entity: a, node, item: 1, count: 5 }); steps(w, 1);
    expect(G.treesOf(w, a)![ti]!.xp).toBe(2 * G.XP.sources.gather!);
  });
  it("AI humans keep progressing: x aiHumanMul on every award", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1); const b = mk(w, 2); G.setAiHumanPredicate(w, (e) => e === b);
    expect(G.awardXp(w, a, "chop")).toBe(G.XP.sources.chop); expect(G.awardXp(w, b, "chop")).toBe(G.XP.sources.chop! * G.XP.aiHumanMul!);
    expect(G.XP.aiHumanMul!).toBeGreaterThan(1);
  });
});
