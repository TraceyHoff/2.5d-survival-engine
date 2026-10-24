/**
 * ADR-113 skill tree data + pure reads (no gameplay imports besides components, so every system can hook it without
 * import cycles). Node index = bit in Progression.nodes (skills.json order is append-only).
 */
import type { Entity, World } from "@engine/core";
import raw from "../../data/skills.json";
import { Progression } from "../components.js";

export type SkillMod = "gather" | "cropYield" | "carry" | "fuel" | "vfuel" | "repair" | "nutrition" | "heal" | "produce" | "tame" | "share" | "xp" | "noise" | `dmg_${string}`;
export type XpSource = "gather" | "craft" | "combat" | "kill" | "farm" | "hunt" | "build" | "tame" | "cook" | "heal" | "repair";
export interface SkillNodeDef {
  key: string; name: string; branch: string; tier: number; x: number; y: number; cost: number; requires: string[]; desc: string; icon: string; retired?: boolean;
  effects: { skill?: { key: string; level: number }; mods?: Partial<Record<string, number>>; perk?: string };
}
export interface SkillsData {
  xp: Record<XpSource, number>;
  levels: { base: number; growth: number; pointsPerLevel: number; maxLevel: number; bonusEvery: number; bonusPoints: number };
  respec: { item: string; base: number; perRespec: number; refundFraction: number };
  weaponClasses: Record<string, string[]>;
  husbandry: { feed: string; trough: string; reach: number; troughRange: number; penRadius: number; fedSeconds: number; tameBase: number; breedSeconds: number; maxPerTrough: number; animals: Record<string, { produce: string; seconds: number }> };
  branches: { key: string; name: string; icon: string }[];
  nodes: SkillNodeDef[];
}
export const SKILLS: SkillsData = raw as unknown as SkillsData;
export const SKILL_NODE_WORDS = 8;
if (SKILLS.nodes.length > SKILL_NODE_WORDS * 32) throw new Error("skills.json: too many nodes for Progression.nodes");
const byKey = new Map(SKILLS.nodes.map((n, i) => [n.key, i]));
export const skillNodeIndex = (key: string): number => byKey.get(key) ?? -1;
export const skillNode = (i: number): SkillNodeDef | undefined => SKILLS.nodes[i];
/** Prerequisite indices per node. */
export const SKILL_REQS: readonly number[][] = SKILLS.nodes.map((n) => n.requires.map((r) => { const i = byKey.get(r); if (i === undefined) throw new Error(`skills.json: ${n.key} requires unknown ${r}`); return i; }));

/** Weapon class of an item key ("unarmed" for none). */
export function weaponClassOf(itemKey: string | undefined): string {
  if (!itemKey) return "unarmed";
  let best = "", bestLen = 0;
  for (const [c, pats] of Object.entries(SKILLS.weaponClasses)) for (const p of pats) if (itemKey.includes(p) && p.length > bestLen) { best = c; bestLen = p.length; }
  return best || "unarmed";
}

// ---- level curve -------------------------------------------------------------------------------------
export const xpToNext = (level: number): number => Math.round(SKILLS.levels.base * Math.pow(SKILLS.levels.growth, Math.max(0, level - 1)));
export const pointsForLevel = (level: number): number => SKILLS.levels.pointsPerLevel + (SKILLS.levels.bonusEvery > 0 && level % SKILLS.levels.bonusEvery === 0 ? SKILLS.levels.bonusPoints : 0);

// ---- per-entity reads --------------------------------------------------------------------------------
export function nodeWords(world: World, e: Entity): readonly number[] | undefined {
  if (!world.has(e, Progression)) return undefined; const a = world.getArray(e, Progression, "nodes"); return a ? Array.from(a) : undefined;
}
export const wordsHas = (w: readonly number[], i: number): boolean => ((w[i >>> 5] ?? 0) >>> (i & 31) & 1) === 1;
export function hasNode(world: World, e: Entity, i: number): boolean { const w = nodeWords(world, e); return !!w && wordsHas(w, i); }
export function ownedNodes(world: World, e: Entity): number[] { const w = nodeWords(world, e); if (!w) return []; const o: number[] = []; for (let i = 0; i < SKILLS.nodes.length; i++) if (wordsHas(w, i)) o.push(i); return o; }

interface Totals { mods: Map<string, number>; perks: Set<string>; skills: Map<string, number> }
const cache = new Map<string, Totals>();
function totalsOf(w: readonly number[]): Totals {
  const k = w.join(","); let t = cache.get(k); if (t) return t;
  t = { mods: new Map(), perks: new Set(), skills: new Map() };
  for (let i = 0; i < SKILLS.nodes.length; i++) {
    if (!wordsHas(w, i)) continue; const n = SKILLS.nodes[i]!; if (n.retired) continue;
    for (const [m, v] of Object.entries(n.effects.mods ?? {})) t.mods.set(m, (t.mods.get(m) ?? 0) + (v ?? 0));
    if (n.effects.perk) t.perks.add(n.effects.perk);
    if (n.effects.skill) t.skills.set(n.effects.skill.key, Math.max(t.skills.get(n.effects.skill.key) ?? 0, n.effects.skill.level));
  }
  if (cache.size > 512) cache.clear(); cache.set(k, t); return t;
}
/** Additive fraction for a mod (0 without Progression). Multiply by (1 + skillMod). */
export function skillMod(world: World, e: Entity, mod: SkillMod): number { const w = nodeWords(world, e); return w ? totalsOf(w).mods.get(mod) ?? 0 : 0; }
export const skillMul = (world: World, e: Entity, mod: SkillMod, min = 0.1): number => Math.max(min, 1 + skillMod(world, e, mod));
export function hasPerk(world: World, e: Entity, perk: string): boolean { const w = nodeWords(world, e); return !!w && totalsOf(w).perks.has(perk); }
/** Recipe skill level granted by nodes; undefined when the entity has no Progression (legacy / NPC crafters). */
export function skillLevelOf(world: World, e: Entity, key: string): number | undefined { const w = nodeWords(world, e); return w ? totalsOf(w).skills.get(key) ?? 0 : undefined; }
/** Damage multiplier for the held weapon class. */
export const damageMulFor = (world: World, e: Entity, itemKey: string | undefined): number => skillMul(world, e, `dmg_${weaponClassOf(itemKey)}`);
/** Integer amount scaled by a multiplier with a deterministic fractional roll (r in [0,1)). */
export const scaleCount = (n: number, mul: number, r: number): number => { const v = n * mul; const f = Math.floor(v); return f + (r < v - f ? 1 : 0); };
