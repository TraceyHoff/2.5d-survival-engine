import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, type World } from "@engine/core";
import * as G from "../src/index.js";
import { spawnPlayer } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

/** ADR-209: per-tree XP / level / points. */
const mk = (w: World, pid: number) => { const p = spawnPlayer(w, { x: 0, y: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }); G.migrateProgression(w, p); return p; };
function world() { const w = makeWorld(); installPermissions(w); return w; }
const tx = (w: World, e: number, t: string) => G.treesOf(w, e as never)![G.treeIndex(t)]!;
const cost = (k: string) => G.skillNode(G.skillNodeIndex(k))!.cost;

describe("ADR-209 per-tree progression", () => {
  it("every xp source maps to a real tree; every node has a tree", () => {
    for (const s of Object.keys(G.XP.sources)) expect(G.TREE_KEYS).toContain(G.XP.trees[s]);
    expect(G.SKILL_NODE_TREE.length).toBe(G.SKILLS.nodes.length); expect(G.TREE_KEYS.length).toBeLessThanOrEqual(G.TREE_SLOTS);
  });
  it("awards go only to the activity's tree (+ the perks share) and level that tree", () => {
    const w = world(); const a = mk(w, 1);
    const got = G.awardXpRaw(w, a, "chop", 100);
    expect(tx(w, a, "survival").xp + G.treeXpToNext(1) * (tx(w, a, "survival").level - 1)).toBeGreaterThan(0);
    expect(tx(w, a, "survival").level).toBeGreaterThanOrEqual(2); expect(tx(w, a, "survival").points).toBeGreaterThanOrEqual(1);
    expect(tx(w, a, "combat")).toEqual({ xp: 0, level: 1, points: 0 }); expect(tx(w, a, "crafting")).toEqual({ xp: 0, level: 1, points: 0 });
    expect(tx(w, a, "perks").xp).toBe(Math.round(got * G.XP.perksShare));
    G.awardXpRaw(w, a, "kill", 50); expect(tx(w, a, "combat").xp + tx(w, a, "combat").level).toBeGreaterThan(1);
    G.awardXpRaw(w, a, "cook", 10); expect(tx(w, a, "homestead").xp).toBeGreaterThan(0);
    G.awardXpRaw(w, a, "craft", 10); expect(tx(w, a, "crafting").xp).toBeGreaterThan(0);
  });
  it("tree level-ups emit TreeLevelUp; the global row grants no points", () => {
    const w = world(); const a = mk(w, 1); const seen: string[] = []; w.events.on(G.TreeLevelUp, (e: { tree: string }) => { seen.push(e.tree); });
    G.awardXpRaw(w, a, "kill", G.treeXpToNext(1) + 1); steps(w, 1); expect(seen).toContain("combat");
    expect(w.get(a, G.Progression)!.points).toBe(0);
  });
  it("points can only be spent in their own tree", () => {
    expect(G.TREE_KEYS[G.SKILL_NODE_TREE[G.skillNodeIndex("brawler")]!]).toBe("combat");
    const w = world(); const a = mk(w, 1); G.grantTreePoints(w, a, "combat", 50);
    expect(G.canUnlock(w, a, G.skillNodeIndex("forager"))).toBe("points");
    expect(G.unlockSkill(w, a, G.skillNodeIndex("brawler"))).toBeUndefined();
    expect(G.treePoints(w, a, "combat")).toBe(50 - cost("brawler")); expect(G.treePoints(w, a, "survival")).toBe(0);
  });
  it("respec refunds each tree its own spend", () => {
    const w = world(); const a = mk(w, 1); G.grantTreePoints(w, a, "combat", 5); G.grantTreePoints(w, a, "survival", 5);
    G.unlockSkill(w, a, G.skillNodeIndex("brawler")); G.unlockSkill(w, a, G.skillNodeIndex("forager"));
    w.set(a, G.Progression, { level: 30 }); G.addItem(w, a, G.defaultDefs().itemId("coin"), 10000);
    expect(G.respecSkills(w, a)).toBeUndefined(); expect(G.treePoints(w, a, "combat")).toBe(5); expect(G.treePoints(w, a, "survival")).toBe(5);
  });
});

describe("ADR-209 legacy conversion", () => {
  const words = (keys: string[]) => { const ws = new Array(G.SKILL_NODE_WORDS).fill(0); for (const k of keys) { const i = G.skillNodeIndex(k); ws[i >> 5] |= 1 << (i & 31); } return ws.map((x) => x >>> 0); };
  it("charges learned nodes to their tree with a covering level; splits leftovers fairly", () => {
    const t = G.convertLegacyProgression(9, words(["brawler", "forager"]));
    const ci = G.treeIndex("combat"), si = G.treeIndex("survival");
    expect(G.treePointsAtLevel(t[ci]!.level)).toBeGreaterThanOrEqual(cost("brawler"));
    expect(t[ci]!.level === 1 || G.treePointsAtLevel(t[ci]!.level - 1) < cost("brawler")).toBe(true);
    const surplus = t.map((x, i) => x.points - (G.treePointsAtLevel(x.level) - (i === ci ? cost("brawler") : i === si ? cost("forager") : 0)));
    expect(surplus.reduce((s, x) => s + x, 0)).toBe(9); // every legacy unspent point is kept
    expect(Math.max(...surplus) - Math.min(...surplus)).toBeLessThanOrEqual(1); // even split
    expect(surplus[ci]).toBe(Math.floor(9 / t.length)); // remainder went to trees with less spent
    expect(t.every((x) => x.xp === 0)).toBe(true);
  });
  it("in-world migration: nodes stay learned, legacy pool zeroed, idempotent", () => {
    const w = world(); const a = spawnPlayer(w, { x: 0, y: 0, clientId: 1 });
    w.set(a, G.Progression, { points: 7, tver: 0, level: 12 }); w.setElement(a, G.Progression, "nodes", G.skillNodeIndex("forager") >> 5, words(["forager"])[G.skillNodeIndex("forager") >> 5]!);
    const before = G.treesOf(w, a); expect(G.migrateProgression(w, a)).toBe(true); expect(G.migrateProgression(w, a)).toBe(false);
    expect(G.treesOf(w, a)).toEqual(before); expect(w.get(a, G.Progression)!.points).toBe(0); expect(w.get(a, G.Progression)!.level).toBe(12);
    expect(G.hasNode(w, a, G.skillNodeIndex("forager"))).toBe(true);
  });
});
