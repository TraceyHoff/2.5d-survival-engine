/**
 * ADR-113 progression: XP from gathering/crafting/combat/farming/hunting/building/taming/cooking/healing/repair,
 * levels -> skill points, node unlocks (prereqs + cost), paid respec, AI picks by personality (same commands),
 * and the recipe skill provider (setSkillLevelProvider). Authority-only writes; Progression replicates + persists.
 */
import { defineCommand, Membership, Transform, type CommandHandlers, type Entity, type Traits, type World } from "@engine/core";
import { Animal, BuildPiece, Dead, Health, Progression, ResourceNode, Zombie } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { CraftCompleted, Damaged, emit, ev, ItemConsumed, ItemGathered, PiecePlaced } from "../events.js";
import { countItem, removeItem } from "../inventory.js";
import { setSkillLevelProvider } from "../systems/crafting.js";
import { VehicleRepaired } from "../vehicle_craft.js";
import { nodeWords, ownedNodes, pointsForLevel, SKILL_NODE_CATEGORY, SKILL_NODE_WORDS, SKILL_REQS, SKILLS, skillLevelOf, skillMod, skillNode, wordsHas, xpToNext, type XpSource } from "./tree.js";

export const LevelUp = ev<{ entity: Entity; level: number; points: number }>("gameplay.LevelUp");
export const SkillUnlocked = ev<{ entity: Entity; node: number }>("gameplay.SkillUnlocked");
export const SkillsRespecced = ev<{ entity: Entity; refunded: number; cost: number }>("gameplay.SkillsRespecced");

export const UnlockSkillCmd = defineCommand("gameplay.unlockSkill", { node: "u16" });
export const RespecSkillsCmd = defineCommand("gameplay.respecSkills", {});
export const SKILL_COMMANDS = [UnlockSkillCmd, RespecSkillsCmd] as const;

const blank = { xp: 0, level: 1, points: 0, respecs: 0 };
export function ensureProgression(world: World, e: Entity): void { if (!world.has(e, Progression)) world.add(e, Progression, blank); }

/** Award XP (scaled by the source table x skill "xp" mod); levels up and grants points. Shares to nearby party/clan. */
export function awardXp(world: World, e: Entity, source: XpSource, units = 1, share = true): number {
  if (!isAuthority(world) || world.isReplaying || !world.isAlive(e) || !world.has(e, Progression)) return 0;
  const amount = Math.round((SKILLS.xp[source] ?? 0) * units * (1 + skillMod(world, e, "xp")));
  if (amount <= 0) return 0;
  addXp(world, e, amount);
  const sh = share ? skillMod(world, e, "share") : 0;
  if (sh > 0) { const mates = matesNear(world, e, 20); const each = Math.round(amount * sh); if (each > 0) for (const m of mates) addXp(world, m, each); }
  return amount;
}
function addXp(world: World, e: Entity, amount: number): void {
  const p = world.get(e, Progression)!; let { xp, level, points } = p; xp += amount; let up = false;
  while (level < SKILLS.levels.maxLevel && xp >= xpToNext(level)) { xp -= xpToNext(level); level++; points += pointsForLevel(level); up = true; }
  if (level >= SKILLS.levels.maxLevel) xp = Math.min(xp, xpToNext(level));
  world.set(e, Progression, { xp, level, points });
  if (up) emit(world, LevelUp, { entity: e, level, points });
}
function matesNear(world: World, e: Entity, r: number): Entity[] {
  const m = world.get(e, Membership); const t = world.get(e, Transform); if (!m || !t || (!m.partyId && !m.clanId)) return [];
  const out: Entity[] = [];
  for (const o of world.query([Progression, Membership, Transform], [Dead])) {
    if (o === e) continue; const om = world.get(o, Membership)!; if (!((m.partyId && om.partyId === m.partyId) || (m.clanId && om.clanId === m.clanId))) continue;
    const ot = world.get(o, Transform)!; if (Math.hypot(ot.x - t.x, ot.y - t.y) <= r) out.push(o);
  }
  return out.sort((a, b) => a - b);
}

// ---- unlock / respec ---------------------------------------------------------------------------------
export type SkillReject = "no_progression" | "bad_node" | "owned" | "requires" | "points" | "retired" | "cost" | "nothing";
export function canUnlock(world: World, e: Entity, node: number): SkillReject | undefined {
  const w = nodeWords(world, e); if (!w) return "no_progression";
  const n = skillNode(node); if (!n) return "bad_node"; if (n.retired) return "retired";
  if (wordsHas(w, node)) return "owned";
  if (!SKILL_REQS[node]!.every((r) => wordsHas(w, r))) return "requires";
  if ((world.getField(e, Progression, "points") ?? 0) < n.cost) return "points";
  return undefined;
}
export function unlockSkill(world: World, e: Entity, node: number): SkillReject | undefined {
  const why = canUnlock(world, e, node); if (why) return why;
  const a = world.getArray(e, Progression, "nodes")!; world.setElement(e, Progression, "nodes", node >>> 5, (a[node >>> 5]! | (1 << (node & 31))) >>> 0);
  world.set(e, Progression, { points: world.getField(e, Progression, "points")! - skillNode(node)!.cost });
  emit(world, SkillUnlocked, { entity: e, node }); return undefined;
}
export const respecCost = (world: World, e: Entity): number => SKILLS.respec.base + SKILLS.respec.perRespec * (world.getField(e, Progression, "respecs") ?? 0);
export function canRespec(world: World, e: Entity): SkillReject | undefined {
  if (!world.has(e, Progression)) return "no_progression"; if (!ownedNodes(world, e).length) return "nothing";
  const item = safeItem(world, SKILLS.respec.item); if (item === undefined || countItem(world, e, item) < respecCost(world, e)) return "cost";
  return undefined;
}
export function respecSkills(world: World, e: Entity): SkillReject | undefined {
  const why = canRespec(world, e); if (why) return why;
  const cost = respecCost(world, e); removeItem(world, e, gameplayDefs(world).itemId(SKILLS.respec.item), cost);
  const spent = ownedNodes(world, e).reduce((s, i) => s + skillNode(i)!.cost, 0); const refunded = Math.floor(spent * SKILLS.respec.refundFraction);
  for (let i = 0; i < SKILL_NODE_WORDS; i++) world.setElement(e, Progression, "nodes", i, 0);
  const p = world.get(e, Progression)!; world.set(e, Progression, { points: p.points + refunded, respecs: Math.min(255, p.respecs + 1) });
  emit(world, SkillsRespecced, { entity: e, refunded, cost }); return undefined;
}

function safeItem(world: World, key: string): number | undefined { try { return gameplayDefs(world).itemId(key); } catch { return undefined; } }

// ---- AI (personality) ---------------------------------------------------------------------------------
/** Branch weights per trait: brave -> combat, industrious -> crafting/building/farming, social -> leadership/cooking/medicine, greedy -> survival/vehicles/husbandry, chatty -> leadership; low bravery -> stealth. */
const BRANCH_TRAITS: Record<string, (t: Traits) => number> = {
  survival: (t) => 0.6 + 0.4 * t.greed, combat: (t) => 0.3 + 1.2 * t.bravery, crafting: (t) => 0.4 + t.industriousness, farming: (t) => 0.3 + 0.8 * t.industriousness,
  husbandry: (t) => 0.2 + 0.6 * t.industriousness + 0.3 * t.greed, cooking: (t) => 0.3 + 0.6 * t.sociability, medicine: (t) => 0.3 + 0.5 * t.sociability + 0.3 * (1 - t.bravery),
  building: (t) => 0.3 + 0.9 * t.industriousness, vehicles: (t) => 0.2 + 0.5 * t.greed + 0.3 * t.bravery, stealth: (t) => 0.2 + 0.9 * (1 - t.bravery),
  perks: (t) => 0.1 + 0.4 * t.greed, leadership: (t) => 0.1 + 0.7 * t.sociability + 0.4 * t.chattiness,
};
/** Best affordable node for a personality (deterministic: ties -> lower index). undefined when nothing is affordable. */
export function pickSkillNode(world: World, e: Entity, traits: Traits): number | undefined {
  let best: number | undefined, bestScore = -Infinity;
  for (let i = 0; i < SKILLS.nodes.length; i++) {
    if (canUnlock(world, e, i)) continue; const n = skillNode(i)!;
    const s = (BRANCH_TRAITS[n.branch]?.(traits) ?? 0.5) * (1 + 0.15 * n.tier) / n.cost;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

// ---- install -----------------------------------------------------------------------------------------
function fnv(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
export const SKILLS_HASH = fnv(JSON.stringify(SKILLS));
const isPlayer = (world: World, e: Entity): boolean => world.isAlive(e) && world.has(e, Progression);
/** Hooks XP sources + the recipe skill provider. Entities without Progression (NPC crafters, legacy tests) are not gated. */
export function installProgression(world: World): void {
  world.addSchemaSalt("gameplay.skills", SKILLS_HASH);
  setSkillLevelProvider(world, (e, key) => skillLevelOf(world, e, key) ?? Number.MAX_SAFE_INTEGER);
  const defs = gameplayDefs(world);
  world.events.on(ItemGathered, (p: { entity: Entity; node: Entity; count: number }) => {
    if (!isPlayer(world, p.entity)) return;
    const kind = world.getField(p.node, ResourceNode, "kind");
    const key = kind === undefined ? undefined : defs.resources.get(kind)?.key;
    awardXp(world, p.entity, key?.startsWith("crop_") ? "farm" : "gather", Math.max(1, p.count));
  });
  world.events.on(CraftCompleted, (p: { entity: Entity; recipe: number; item: number }) => {
    if (!isPlayer(world, p.entity)) return; const it = defs.items.get(p.item);
    awardXp(world, p.entity, it?.food && it.food.hunger > 0 ? "cook" : "craft");
  });
  world.events.on(Damaged, (p: { target: Entity; source: Entity; amount: number }) => {
    if (!isPlayer(world, p.source) || p.source === p.target || world.has(p.target, BuildPiece)) return;
    const hunt = world.has(p.target, Animal);
    awardXp(world, p.source, "combat", p.amount);
    if ((world.getField(p.target, Health, "hp") ?? 1) <= 0) awardXp(world, p.source, hunt ? "hunt" : "kill", hunt ? 1 : world.has(p.target, Zombie) ? 1 : 2);
  });
  world.events.on(PiecePlaced, (p: { builder: Entity }) => { if (isPlayer(world, p.builder)) awardXp(world, p.builder, "build"); });
  world.events.on(ItemConsumed, (p: { entity: Entity; item: number }) => {
    const f = defs.items.get(p.item)?.food; if (isPlayer(world, p.entity) && f && f.health > 0 && f.hunger === 0) awardXp(world, p.entity, "heal");
  });
  world.events.on(VehicleRepaired, (p: { entity: Entity }) => { if (isPlayer(world, p.entity)) awardXp(world, p.entity, "repair"); });
}
/** Server/host command handlers (players and AI humans use the same commands). */
export function installSkillHandlers(world: World, h: CommandHandlers): void {
  h.on(UnlockSkillCmd, { validate: (v, ctx) => canUnlock(world, ctx.actor, v.node), handle: (v, ctx) => { unlockSkill(world, ctx.actor, v.node); } });
  h.on(RespecSkillsCmd, { validate: (_v, ctx) => canRespec(world, ctx.actor), handle: (_v, ctx) => { respecSkills(world, ctx.actor); } });
}
/** Gives a player entity its Progression row (called on spawn). */
export const PROGRESSION_WORDS = SKILL_NODE_WORDS;

// ---- view model (client skill-tree panel) ---------------------------------------------------------------
export type SkillNodeState = "owned" | "available" | "locked";
export interface SkillNodeView { index: number; key: string; name: string; branch: string; category: string; cx: number; cy: number; tier: number; x: number; y: number; cost: number; desc: string; icon: string; state: SkillNodeState; why?: SkillReject | undefined; requires: number[] }
/** ADR-132: one tab per category; node coordinates (cx, cy) are laid out per category tree, branches side by side. */
/** Lanes are 80 apart in skills.json but nodes draw 150 wide: spread them so siblings never overlap. */
export const LANE_SPREAD = 2.1;
export interface SkillCategoryView { key: string; name: string; icon: string; branches: string[]; nodes: number[]; owned: number; available: number; width: number; height: number }
export interface ProgressionView { categories: SkillCategoryView[]; level: number; xp: number; next: number; points: number; respecCost: number; canRespec: SkillReject | undefined; branches: { key: string; name: string; icon: string }[]; nodes: SkillNodeView[]; width: number; height: number }
export function progressionView(world: World, e: Entity): ProgressionView | undefined {
  const p = world.get(e, Progression); if (!p) return undefined; const w = nodeWords(world, e)!;
  const nodes = SKILLS.nodes.map((n, i): SkillNodeView => {
    const why = wordsHas(w, i) ? undefined : canUnlock(world, e, i);
    return { index: i, key: n.key, name: n.name, branch: n.branch, category: SKILL_NODE_CATEGORY[i]!, cx: 0, cy: n.y, tier: n.tier, x: n.x, y: n.y, cost: n.cost, desc: n.desc, icon: n.icon,
      state: wordsHas(w, i) ? "owned" : why === undefined || why === "points" ? "available" : "locked", why, requires: SKILL_REQS[i]! as number[] };
  });
  const categories = SKILLS.categories.map((c): SkillCategoryView => {
    let cursor = 0; const idx: number[] = [];
    for (const b of c.branches) {
      const bn = nodes.filter((n) => n.branch === b); if (!bn.length) continue; const minX = Math.min(...bn.map((n) => n.x));
      for (const n of bn) { n.cx = cursor + (n.x - minX) * LANE_SPREAD; idx.push(n.index); }
      cursor += (Math.max(...bn.map((n) => n.x)) - minX) * LANE_SPREAD + 200;
    }
    const cn = idx.map((i) => nodes[i]!);
    return { key: c.key, name: c.name, icon: c.icon, branches: [...c.branches], nodes: idx, owned: cn.filter((n) => n.state === "owned").length,
      available: cn.filter((n) => n.state === "available" && n.why === undefined).length, width: Math.max(0, cursor - 200) + 240, height: Math.max(0, ...cn.map((n) => n.cy)) + 120 };
  });
  return { categories, level: p.level, xp: p.xp, next: xpToNext(p.level), points: p.points, respecCost: respecCost(world, e), canRespec: canRespec(world, e),
    branches: SKILLS.branches.map((b) => ({ ...b })), nodes, width: Math.max(...nodes.map((n) => n.x)) + 240, height: Math.max(...nodes.map((n) => n.y)) + 120 };
}
export const SKILL_REJECT_TEXT: Readonly<Record<SkillReject, string>> = {
  no_progression: "No progression", bad_node: "Unknown skill", owned: "Already learned", requires: "Learn the connected skills first", points: "Not enough skill points",
  retired: "Retired skill", cost: "Not enough coin to respec", nothing: "No skills to reset",
};
export const unlockSkillIntent = (node: number): { cmd: typeof UnlockSkillCmd; args: { node: number } } => ({ cmd: UnlockSkillCmd, args: { node } });
export const respecSkillsIntent = (): { cmd: typeof RespecSkillsCmd; args: Record<string, never> } => ({ cmd: RespecSkillsCmd, args: {} });
