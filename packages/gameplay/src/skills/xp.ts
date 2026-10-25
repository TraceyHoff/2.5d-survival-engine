/**
 * ADR-135 XP: the single tunables table (data/xp.json) + pure helpers for kill XP (victim type x kind x level),
 * PvP diminishing returns and travel XP. Authority-only state; Progression (networked + persistent) holds the result.
 */
import { defineResource, PlayerId, Transform, type Entity, type World } from "@engine/core";
import raw from "../../data/xp.json";
import WEAR_COSMETICS from "../../data/wear_cosmetics.json";
import { entityIndex } from "@engine/core";
import { WearSlot, WEAR_SLOTS } from "../defs.js";
import { gameplayDefs } from "../config.js";
const itemDef = (world: World, id: number) => gameplayDefs(world).items.get(id);
import { Animal, Driver, Progression, Worn, Zombie } from "../components.js";
import { animalDefs } from "../population.js";

export interface KillTypeDef { base: number; perLevel: number; kindMul: Record<string, number> }
export interface XpTable {
  sources: Record<string, number>;
  kills: { zombie: KillTypeDef; animal: KillTypeDef; aiHuman: KillTypeDef; player: KillTypeDef; maxLevelMul: number };
  pvp: { windowSeconds: number; decay: number; minFactor: number; freeKills: number; sameKillerVictimMaxPerWindow: number; lowLevelGap: number; lowLevelMul: number };
  travel: { walkTiles: number; vehicleTiles: number; maxTilesPerSecond: number };
  popup: { minShown: number; mergeMs: number };
}
export const XP: XpTable = raw as unknown as XpTable;
export type VictimType = "zombie" | "animal" | "aiHuman" | "player";

const AiHumanRes = defineResource<{ fn: (e: Entity) => boolean }>("gameplay.xpAiHuman");
/** Server hook: AI humans are virtual players (same components), so the host says which entities are bots. */
export function setAiHumanPredicate(world: World, fn: (e: Entity) => boolean): void { world.setResource(AiHumanRes, { fn }); }
const ZOMBIE_KEYS = ["zombie_walker", "zombie_runner", "zombie_brute", "zombie_snuffer"];
/** Victim classification: zombie, animal, AI human (core Agent) or player (Progression without Agent). */
export function victimType(world: World, v: Entity): VictimType | undefined {
  if (world.has(v, Zombie)) return "zombie";
  if (world.has(v, Animal)) return "animal";
  if (world.getResource(AiHumanRes)?.fn(v)) return "aiHuman";
  if (world.has(v, Progression)) return "player";
  return undefined;
}
function victimKey(world: World, v: Entity, t: VictimType): string {
  if (t === "zombie") { const k = world.getField(v, Zombie, "kind") ?? 0; return (gameplayDefs(world).zombies.get(k) as { key?: string } | undefined)?.key ?? ZOMBIE_KEYS[k] ?? ""; }
  if (t === "animal") return animalDefs()[world.getField(v, Animal, "kind") ?? 0]?.key ?? "";
  return "";
}
/** Base kill XP before PvP diminishing returns and the skill "xp" mod. */
export function killXpBase(world: World, v: Entity): number {
  const t = victimType(world, v); if (!t) return 0;
  const d = XP.kills[t]; const lvl = world.getField(v, Progression, "level") ?? 1;
  const lm = Math.min(XP.kills.maxLevelMul, 1 + d.perLevel * Math.max(0, lvl - 1));
  return d.base * (d.kindMul[victimKey(world, v, t)] ?? 1) * lm;
}

// ---- PvP anti-farming -------------------------------------------------------------------------------
interface PvpLog { m: Map<string, number[]> }
const PvpRes = defineResource<PvpLog>("gameplay.xpPvpLog");
const idOf = (world: World, e: Entity): number => (world.isRegistered(PlayerId) ? world.getField(e, PlayerId, "id") ?? 0 : 0) || e;
/** Multiplier for killer->victim at `tick`: first `freeKills` in the window pay full, then x decay per repeat,
 *  0 after sameKillerVictimMaxPerWindow; victims lowLevelGap+ levels below the killer pay lowLevelMul. Records the kill. */
export function pvpFactor(world: World, killer: Entity, victim: Entity, tickHz = 20, record = true): number {
  let log = world.getResource(PvpRes); if (!log) { log = { m: new Map() }; world.setResource(PvpRes, log); }
  const k = `${idOf(world, killer)}>${idOf(world, victim)}`; const win = XP.pvp.windowSeconds * tickHz;
  const ticks = (log.m.get(k) ?? []).filter((t) => world.tick - t < win);
  const n = ticks.length; const p = XP.pvp;
  let f = n >= p.sameKillerVictimMaxPerWindow ? 0 : n < p.freeKills ? 1 : Math.pow(p.decay, n - p.freeKills + 1);
  f = Math.max(p.minFactor, f);
  const kl = world.getField(killer, Progression, "level") ?? 1, vl = world.getField(victim, Progression, "level") ?? 1;
  if (kl - vl >= p.lowLevelGap) f *= p.lowLevelMul;
  if (record) { ticks.push(world.tick); log.m.set(k, ticks); }
  return f;
}

// ---- travel -----------------------------------------------------------------------------------------
interface TravelLog { m: Map<Entity, { x: number; y: number; t: number; walk: number; drive: number }> }
const TravelRes = defineResource<TravelLog>("gameplay.xpTravel");
/** Accumulates moved tiles per player (teleports / respawns above maxTilesPerSecond are ignored) and returns awards. */
export function travelStep(world: World, tickHz: number, players: Iterable<Entity>): { e: Entity; source: "walk" | "vehicle"; units: number }[] {
  let log = world.getResource(TravelRes); if (!log) { log = { m: new Map() }; world.setResource(TravelRes, log); }
  const out: { e: Entity; source: "walk" | "vehicle"; units: number }[] = []; const seen = new Set<Entity>();
  for (const e of players) {
    const t = world.get(e, Transform); if (!t) continue; seen.add(e);
    const r = log.m.get(e); if (!r) { log.m.set(e, { x: t.x, y: t.y, t: world.tick, walk: 0, drive: 0 }); continue; }
    const d = Math.hypot(t.x - r.x, t.y - r.y); const secs = Math.max(1, world.tick - r.t) / tickHz; r.x = t.x; r.y = t.y; r.t = world.tick;
    if (d <= 0 || d > XP.travel.maxTilesPerSecond * secs) continue;
    if (world.has(e, Driver)) { r.drive += d; if (r.drive >= XP.travel.vehicleTiles) { const u = Math.floor(r.drive / XP.travel.vehicleTiles); r.drive -= u * XP.travel.vehicleTiles; out.push({ e, source: "vehicle", units: u }); } }
    else { r.walk += d; if (r.walk >= XP.travel.walkTiles) { const u = Math.floor(r.walk / XP.travel.walkTiles); r.walk -= u * XP.travel.walkTiles; out.push({ e, source: "walk", units: u }); } }
  }
  for (const e of [...log.m.keys()]) if (!seen.has(e)) log.m.delete(e);
  return out;
}

/** ADR-135: paper-doll overrides for an entity's Worn gear as [appearanceSlot, wearableKey] (accessory slot item beats a back item). */
export function wornCosmetics(world: World, e: Entity): Array<[string, string]> {
  if (!world.isRegistered(Worn) || !world.has(e, Worn)) return [];
  const st = world.store(Worn); const s = st.slot(entityIndex(e)); if (s < 0) return [];
  const fam = (WEAR_COSMETICS as { families: Record<string, string> }).families; const out = new Map<string, string>();
  for (let i = 0; i < WEAR_SLOTS; i++) {
    const it = st.data.item[s * WEAR_SLOTS + i]!; if (!it) continue; const d = itemDef(world, it); const k = d?.family ? fam[d.family] : undefined; if (!k) continue;
    const slot = k.startsWith("acc_") ? "accessory" : k.slice(0, k.indexOf("_"));
    if (slot === "accessory" && out.has("accessory") && i !== WearSlot.Accessory) continue;
    out.set(slot, k);
  }
  return [...out];
}
