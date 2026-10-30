import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { addItem, countItem, defaultDefs, Equipment, slotItem, spawnPlayer } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = defaultDefs(); const id = (k: string) => d.itemId(k);
const mk = (w: World, pid: number, x = 0) => { const p = spawnPlayer(w, { x, y: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }); return p; };
function world() { const w = makeWorld(); installPermissions(w); return w; }
const node = (k: string) => G.skillNodeIndex(k);
/** ADR-209: points are per tree; tests give every tree `pts`. */
const give = (w: World, e: Entity, pts: number) => { for (const k of G.TREE_KEYS) { G.grantTreePoints(w, e, k, pts - G.treePoints(w, e, k)); } };
const traits = (o: Partial<Record<"bravery" | "sociability" | "greed" | "industriousness" | "chattiness", number>>) => ({ bravery: 0.5, sociability: 0.5, greed: 0.5, industriousness: 0.5, chattiness: 0.5, ...o });

describe("ADR-113 skill tree data", () => {
  it("has 12 branches (incl. perks), 7 category trees, 100+ nodes, valid prereqs (earlier, acyclic) and art keys", () => {
    expect(G.SKILLS.branches.length).toBe(12); expect(G.SKILLS.nodes.length).toBeGreaterThanOrEqual(100);
    expect(G.SKILLS.nodes.length).toBeLessThanOrEqual(G.SKILL_NODE_WORDS * 32);
    const keys = new Set<string>();
    G.SKILLS.nodes.forEach((n, i) => {
      expect(keys.has(n.key)).toBe(false); keys.add(n.key); expect(n.icon).toBe(n.effects.unlock ? n.icon : `skill_${n.key}`); expect(n.icon.startsWith("skill_")).toBe(true); // ADR-221 unlock nodes reuse art
      for (const r of n.requires) expect(G.skillNodeIndex(r)).toBeGreaterThanOrEqual(0);
    });
    const seen = new Map<string, number>(); const visit = (k: string): void => { const st = seen.get(k); if (st === 2) return; expect(st).not.toBe(1); seen.set(k, 1); for (const r of G.skillNode(G.skillNodeIndex(k))!.requires) visit(r); seen.set(k, 2); };
    for (const n of G.SKILLS.nodes) visit(n.key);
    for (const b of G.SKILLS.branches) expect(G.SKILLS.nodes.some((n) => n.branch === b.key)).toBe(true);
  });
  it("xp curve grows; weapon classes resolve", () => {
    expect(G.xpToNext(2)).toBeGreaterThan(G.xpToNext(1));
    expect(G.weaponClassOf("iron_sword")).not.toBe("unarmed"); expect(G.weaponClassOf(undefined)).toBe("unarmed");
  });
});

describe("ADR-113 progression", () => {
  it("players spawn with Progression level 1; XP from gathering events levels up and grants points", () => {
    const w = world(); const a = mk(w, 1); expect(w.get(a, G.Progression)!.level).toBe(1);
    const need = G.xpToNext(1); G.awardXp(w, a, "kill", Math.ceil(Math.max(need, G.treeXpToNext(1)) / G.XP.sources.kill!) + 1);
    const p = w.get(a, G.Progression)!; expect(p.level).toBeGreaterThanOrEqual(2);
    const t = G.treesOf(w, a)![G.treeIndex("combat")]!; expect(t.level).toBeGreaterThanOrEqual(2); expect(t.points).toBeGreaterThanOrEqual(1);
  });
  it("unlock respects prereqs and points; command validation uses the same rules", () => {
    const w = world(); const a = mk(w, 1);
    expect(G.canUnlock(w, a, node("forager"))).toBe("points");
    give(w, a, 10);
    expect(G.canUnlock(w, a, node("pack_mule"))).toBe("requires");
    expect(G.unlockSkill(w, a, node("forager"))).toBeUndefined(); expect(G.hasNode(w, a, node("forager"))).toBe(true);
    expect(G.canUnlock(w, a, node("forager"))).toBe("owned");
    expect(G.unlockSkill(w, a, node("pack_mule"))).toBeUndefined();
    expect(G.treePoints(w, a, "survival")).toBe(8); expect(G.treePoints(w, a, "combat")).toBe(10);
    expect(G.skillMul(w, a, "carry")).toBeCloseTo(1.15);
  });
  it("recipe skills come from nodes (setSkillLevelProvider) and gate fresh players", () => {
    const w = world(); const a = mk(w, 1); const r = d.recipes.get(d.recipeId("animal_feed"))!;
    expect(G.meetsSkill(w, a, r)).toBe(false);
    give(w, a, 5); G.unlockSkill(w, a, node("husbandry_1")); expect(G.meetsSkill(w, a, r)).toBe(true);
  });
  it("respec costs coin, refunds points, and the cost grows", () => {
    const w = world(); const a = mk(w, 1); give(w, a, 5); G.unlockSkill(w, a, node("forager"));
    expect(G.canRespec(w, a)).toBe("cost");
    const c0 = G.respecCost(w, a); addItem(w, a, id("coin"), c0 * 3);
    expect(G.respecSkills(w, a)).toBeUndefined();
    expect(G.ownedNodes(w, a).length).toBe(0); expect(G.treePoints(w, a, "survival")).toBe(5);
    expect(countItem(w, a, id("coin"))).toBe(c0 * 2); expect(G.respecCost(w, a)).toBeGreaterThan(c0);
  });
  it("iron stomach: spoiled food no longer makes you sick but costs hp", () => {
    const w = world(); const a = mk(w, 1); give(w, a, 5); G.unlockSkill(w, a, node("iron_stomach"));
    expect(G.hasPerk(w, a, "iron_stomach")).toBe(true); expect(G.IRON_STOMACH_HP).toBeGreaterThan(0);
  });
  it("weapon mastery scales combat damage multiplier per class", () => {
    const w = world(); const a = mk(w, 1); give(w, a, 20);
    const first = G.SKILLS.nodes.findIndex((n) => Object.keys(n.effects.mods ?? {}).some((k) => k.startsWith("dmg_") && k !== "dmg_unarmed"));
    expect(first).toBeGreaterThanOrEqual(0); give(w, a, 100);
    const chain = (i: number): void => { for (const r of G.skillNode(i)!.requires) if (!G.hasNode(w, a, G.skillNodeIndex(r))) chain(G.skillNodeIndex(r)); G.unlockSkill(w, a, i); };
    chain(first); expect(G.hasNode(w, a, first)).toBe(true);
    const cls = Object.keys(G.skillNode(first)!.effects.mods!).find((k) => k.startsWith("dmg_"))!.slice(4);
    const key = [...d.items.values()].find((it) => G.weaponClassOf(it.key) === cls)?.key;
    if (key) expect(G.damageMulFor(w, a, key)).toBeGreaterThan(1);
  });
  it("AI picks by personality: brave -> combat, timid -> stealth/medicine, same validation", () => {
    const w = world(); const a = mk(w, 1); give(w, a, 1);
    // ADR-221: a fresh character learns its base-plan unlocks (campfire) before personality picks
    expect(G.skillNode(G.pickSkillNode(w, a, traits({ bravery: 1, industriousness: 0, sociability: 0, greed: 0, chattiness: 0 }))!)!.key).toBe("firecraft");
    G.grantSkillUnlocks(w, a);
    const brave = G.skillNode(G.pickSkillNode(w, a, traits({ bravery: 1, industriousness: 0, sociability: 0, greed: 0, chattiness: 0 }))!)!;
    const timid = G.skillNode(G.pickSkillNode(w, a, traits({ bravery: 0, industriousness: 0, sociability: 0, greed: 0, chattiness: 0 }))!)!;
    expect(brave.branch).toBe("combat"); expect(timid.branch).toBe("stealth");
    expect(G.actionCommand(`skill:${node("forager")}`)).toEqual({ type: G.UnlockSkillCmd.name, payload: { node: node("forager") } });
  });
});

describe("ADR-113 husbandry", () => {
  it("animal_feed tames a domestic animal (needs skill), feeding keeps it fed; tamed animals are Tamed + persistent", () => {
    const w = world(); const a = mk(w, 1); const ch = G.spawnAnimal(w, "animal_chicken", 1, 0);
    addItem(w, a, id("animal_feed"), 30); let s = 0; for (; s < 32; s++) if (slotItem(w, a, s).item === id("animal_feed")) break;
    w.set(a, Equipment, { mainHandSlot: s, mainHandItem: id("animal_feed") });
    expect(G.husbandryPrompt(w, a)!.fail).toBe(G.TameFail.NeedsSkill);
    give(w, a, 5); G.unlockSkill(w, a, node("husbandry_1"));
    expect(G.husbandryPrompt(w, a)).toMatchObject({ action: "Tame", fail: G.TameFail.None });
    for (let i = 0; i < 40 && !w.has(ch, G.Tamed); i++) { G.setIntent(w, a, { action: G.IntentAction.Use, slot: s }); steps(w, 1); }
    expect(w.has(ch, G.Tamed)).toBe(true); expect(w.get(ch, G.Tamed)!.owner).toBe(a);
    expect(G.husbandryPrompt(w, a)!.action).toBe("Feed");
    expect(w.get(a, G.Progression)!.xp + w.get(a, G.Progression)!.level).toBeGreaterThan(1);
  });
  it("a wolf cannot be domesticated", () => {
    const w = world(); const a = mk(w, 1); G.spawnAnimal(w, "animal_wolf", 1, 0); give(w, a, 5); G.unlockSkill(w, a, node("husbandry_1"));
    expect(G.feedAnimal(w, a, true).fail).toBe(G.TameFail.NotDomestic);
  });
});

describe("ADR-132 category skill trees", () => {
  it("every node is in exactly one category; prereqs stay inside it; each tree has a root", () => {
    const counts = new Map<string, number>();
    G.SKILLS.nodes.forEach((n, i) => {
      const c = G.skillCategoryOf(i)!; expect(c).toBeDefined(); counts.set(c, (counts.get(c) ?? 0) + 1);
      for (const r of n.requires) expect(G.skillCategoryOf(G.skillNodeIndex(r))).toBe(c);
    });
    expect([...counts.keys()].sort()).toEqual(G.SKILLS.categories.map((c) => c.key).sort());
    for (const c of G.SKILLS.categories) expect(G.SKILLS.nodes.some((n, i) => G.skillCategoryOf(i) === c.key && n.requires.length === 0)).toBe(true);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(G.SKILLS.nodes.length);
    expect(G.skillCategoryOf(node("iron_stomach"))).toBe("perks"); expect(G.skillCategoryOf(node("husbandry_1"))).toBe("homestead");
    expect(G.skillCategoryOf(node("blade_mastery"))).toBe("combat");
  });
  it("node ids (= save bit indices) are unchanged: saved unlocks map to the same skills", () => {
    // Pinned indices from before ADR-132; Progression.nodes stores these bits, so they must never move.
    const pinned: Record<string, number> = { forager: 0, iron_stomach: 3, hardy: 7, brawler: 10, monoculture: 64, husbandry_1: 65, light_pack: 113, tactician: 121 };
    for (const [k, i] of Object.entries(pinned)) expect(node(k)).toBe(i);
    const w = world(); const a = mk(w, 1);
    const words = new Array(G.SKILL_NODE_WORDS).fill(0); for (const i of [0, 3, 64, 113]) words[i >>> 5] |= 1 << (i & 31);
    w.set(a, G.Progression, { points: 4 }); const arr = w.getArray(a, G.Progression, "nodes")!; words.forEach((v, j) => { arr[j] = v >>> 0; });
    expect(G.ownedNodes(w, a)).toEqual([0, 3, 64, 113]); expect(G.hasPerk(w, a, "iron_stomach")).toBe(true);
    expect(G.skillMod(w, a, "cropYield")).toBeCloseTo(0.3); expect(w.get(a, G.Progression)!.points).toBe(4);
  });
  it("view: per-tree point pools, per-category trees with their own layout", () => {
    const w = world(); const a = mk(w, 1); give(w, a, 3); G.unlockSkill(w, a, node("iron_stomach"));
    const v = G.progressionView(w, a)!; expect(v.categories.find((c) => c.key === "perks")!.points).toBe(1); expect(v.categories.length).toBe(G.SKILLS.categories.length);
    const perks = v.categories.find((c) => c.key === "perks")!; expect(perks.owned).toBe(1);
    expect(perks.nodes.map((i) => v.nodes[i]!.key)).toContain("light_pack");
    for (const c of v.categories) { expect(Math.min(...c.nodes.map((i) => v.nodes[i]!.cx))).toBe(0); for (const i of c.nodes) expect(v.nodes[i]!.cx).toBeLessThan(c.width); }
    expect(G.canUnlock(w, a, node("light_pack"))).toBe("points"); // prereq (iron_stomach) satisfied within the perks tree
  });
});
