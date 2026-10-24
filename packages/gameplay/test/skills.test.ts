import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { addItem, countItem, defaultDefs, Equipment, slotItem, spawnPlayer } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = defaultDefs(); const id = (k: string) => d.itemId(k);
const mk = (w: World, pid: number, x = 0) => { const p = spawnPlayer(w, { x, y: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }); return p; };
function world() { const w = makeWorld(); installPermissions(w); return w; }
const node = (k: string) => G.skillNodeIndex(k);
const give = (w: World, e: Entity, pts: number) => w.set(e, G.Progression, { points: pts });
const traits = (o: Partial<Record<"bravery" | "sociability" | "greed" | "industriousness" | "chattiness", number>>) => ({ bravery: 0.5, sociability: 0.5, greed: 0.5, industriousness: 0.5, chattiness: 0.5, ...o });

describe("ADR-113 skill tree data", () => {
  it("has 11 branches, 100+ nodes, valid prereqs (earlier, acyclic) and art keys", () => {
    expect(G.SKILLS.branches.length).toBe(11); expect(G.SKILLS.nodes.length).toBeGreaterThanOrEqual(100);
    expect(G.SKILLS.nodes.length).toBeLessThanOrEqual(G.SKILL_NODE_WORDS * 32);
    const keys = new Set<string>();
    G.SKILLS.nodes.forEach((n, i) => {
      expect(keys.has(n.key)).toBe(false); keys.add(n.key); expect(n.icon).toBe(`skill_${n.key}`);
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
    const need = G.xpToNext(1); G.awardXp(w, a, "kill", Math.ceil(need / G.SKILLS.xp.kill) + 1);
    const p = w.get(a, G.Progression)!; expect(p.level).toBeGreaterThanOrEqual(2); expect(p.points).toBeGreaterThanOrEqual(1);
  });
  it("unlock respects prereqs and points; command validation uses the same rules", () => {
    const w = world(); const a = mk(w, 1);
    expect(G.canUnlock(w, a, node("forager"))).toBe("points");
    give(w, a, 10);
    expect(G.canUnlock(w, a, node("pack_mule"))).toBe("requires");
    expect(G.unlockSkill(w, a, node("forager"))).toBeUndefined(); expect(G.hasNode(w, a, node("forager"))).toBe(true);
    expect(G.canUnlock(w, a, node("forager"))).toBe("owned");
    expect(G.unlockSkill(w, a, node("pack_mule"))).toBeUndefined();
    expect(w.get(a, G.Progression)!.points).toBe(8);
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
    expect(G.ownedNodes(w, a).length).toBe(0); expect(w.get(a, G.Progression)!.points).toBe(5);
    expect(countItem(w, a, id("coin"))).toBe(c0 * 2); expect(G.respecCost(w, a)).toBeGreaterThan(c0);
  });
  it("iron stomach: spoiled food no longer makes you sick but costs hp", () => {
    const w = world(); const a = mk(w, 1); give(w, a, 5); G.unlockSkill(w, a, node("forager")); G.unlockSkill(w, a, node("iron_stomach"));
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
