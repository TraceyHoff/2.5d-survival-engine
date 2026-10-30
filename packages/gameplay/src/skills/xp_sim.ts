/**
 * ADR-225: a modelled "normal play" session per skill tree, used to tune the per-tree XP curve.
 * Rates are averaged over an hour of focused play in that tree INCLUDING walking, inventory, stamina
 * waits and node respawns (derived from data/resources.json cooldowns ~1 s, ~1/3 duty on swings).
 * `items` = average ItemGathered item count per swing (pre-ADR-225 gather XP paid source x items).
 */
import { XP } from "./xp.js";
import { treeXpCurve } from "./tree.js";

export interface SimActivity { source: string; perMin: number; items?: number; xp?: number }
export interface SimProfile { tree: string; acts: SimActivity[] }
export const PLAY_PROFILES: readonly SimProfile[] = [
  { tree: "survival", acts: [{ source: "gather", perMin: 6, items: 3 }, { source: "chop", perMin: 4, items: 4.5 }, { source: "mine", perMin: 2, items: 3 }, { source: "walk", perMin: 3 }] },
  { tree: "crafting", acts: [{ source: "craft", perMin: 2.5 }, { source: "build", perMin: 2 }] },
  { tree: "homestead", acts: [{ source: "cook", perMin: 1.5 }, { source: "farm", perMin: 1, items: 3 }, { source: "plant", perMin: 2 }, { source: "till", perMin: 1 }, { source: "water", perMin: 2 }] },
  { tree: "combat", acts: [{ source: "combat", perMin: 30 }, { source: "kill", perMin: 0.6, xp: 15 }] },
];
export interface CurveLike { base: number; growth: number; early?: readonly number[] }
/** Pre-ADR-225 tree curve (skills.json treeLevels before the retune). */
export const OLD_TREE_CURVE: CurveLike = { base: 40, growth: 1.1 };
/** XP per minute for a profile; perItem = the pre-ADR-225 gather rule (XP x items per swing). */
export function xpPerMinute(p: SimProfile, perItem: boolean): number {
  return p.acts.reduce((s, a) => s + a.perMin * (a.xp ?? (XP.sources[a.source] ?? 0) * (perItem ? a.items ?? 1 : 1)), 0);
}
/** Minutes of play to reach each level 2..maxLevel. */
export function minutesToLevels(xpPerMin: number, curve: CurveLike, maxLevel = 10): number[] {
  const out: number[] = []; let cum = 0;
  for (let l = 1; l < maxLevel; l++) { cum += treeXpCurve(l, curve); out.push(cum / xpPerMin); }
  return out;
}
/** Tree level after `minutes` of play. */
export function levelAfter(xpPerMin: number, curve: CurveLike, minutes: number): number {
  let xp = xpPerMin * minutes; let l = 1; while (l < 60 && xp >= treeXpCurve(l, curve)) { xp -= treeXpCurve(l, curve); l++; } return l;
}
