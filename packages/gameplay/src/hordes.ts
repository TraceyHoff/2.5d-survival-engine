/**
 * ADR-121 roaming zombie hordes. A server-only director (gameplay.hordes) that, once the world's grace period is over
 * (WorldRules.hordeGraceDays in-game days, doubled for targets whose players are below hordes.minTargetLevel), sends
 * one horde per hordes.intervalDays at dusk / night toward a player- or clan-owned structure group. Hordes are plain
 * zombies tagged HordeMember: the zombie AI walks them to the target piece and attacks it, so fire light avoidance,
 * snuffers (part of the composition), defenses and wall breaking all apply unchanged. Members do not despawn when no
 * player is near. WorldRules.hordes = 0 disables the director entirely.
 *
 * Size (hordeSize): scale = min(scaleCap, 1 + levelScalePerLevel * (avgLevel - 1) + dayScalePerDay * daysPastGrace)
 *   solo: min(solo.cap, round(solo.base * scale))
 *   clan: min(clan.cap, round((clan.base + clan.perMember * members) * scale))
 * then clipped to the global budget (maxHordeZombies alive in hordes, maxActiveHordes). With the shipped data the
 * smallest clan horde (16) is larger than the largest solo horde (14).
 */
import { terrainBlocksWalker } from "./systems/movement.js";
import { defineResource, GroupKind, TimeOfDay as TimeOfDayLike, Permissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import raw from "../data/roads.json";
import { BuildPiece, Dead, HordeMember, HordePhase, HordeStatus, PieceOwner, Progression, Survival, Tribe, WorldRules, Zombie, ZombieBrain, ZState } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { secondsToTicks } from "./defs.js";
import { currentPhaseKey, spawnZombie } from "./combat/zombies.js";
import { TerrainRes } from "./world.js";

export interface HordeTuning {
  enabledDefault: boolean; graceDaysDefault: number; lowLevelGraceMul: number; minTargetLevel: number; intervalDays: number; warnSeconds: number;
  phases: string[]; solo: { base: number; cap: number }; clan: { base: number; perMember: number; cap: number };
  levelScalePerLevel: number; dayScalePerDay: number; scaleCap: number; maxActiveHordes: number; maxHordeZombies: number;
  spawnRingMin: number; spawnRingMax: number; targetRadius: number; composition: Record<string, number>; minPiecesPerTarget: number;
}
export const HORDES = raw.hordes as HordeTuning;
export const HORDES_EVERY = 20;
export const enum HordeKind { Solo = 1, Clan = 2 }

/** Pure size formula (see file header). */
export function hordeSize(o: { clan: boolean; members?: number; level?: number; daysPastGrace?: number }, t: HordeTuning = HORDES): number {
  const scale = Math.min(t.scaleCap, 1 + t.levelScalePerLevel * Math.max(0, (o.level ?? 1) - 1) + t.dayScalePerDay * Math.max(0, o.daysPastGrace ?? 0));
  if (!o.clan) return Math.min(t.solo.cap, Math.max(1, Math.round(t.solo.base * scale)));
  return Math.min(t.clan.cap, Math.round((t.clan.base + t.clan.perMember * Math.max(1, o.members ?? 1)) * scale));
}

export interface WorldRulesOpts { hordes?: boolean; hordeGraceDays?: number }
/** Sets the replicated world rules on the environment singleton (server/standalone at install; loaders after meta). */
export function setWorldRules(world: World, r: WorldRulesOpts): void {
  const cur = world.get(world.environment, WorldRules);
  const hordes = r.hordes ?? (cur ? cur.hordes === 1 : HORDES.enabledDefault);
  const grace = Math.max(0, Math.min(365, r.hordeGraceDays ?? cur?.hordeGraceDays ?? HORDES.graceDaysDefault));
  const v = { hordes: hordes ? 1 : 0, hordeGraceDays: grace };
  if (cur) world.set(world.environment, WorldRules, v); else world.add(world.environment, WorldRules, v);
}
export function worldRules(world: World): { hordes: boolean; hordeGraceDays: number } {
  const r = world.get(world.environment, WorldRules);
  return { hordes: r ? r.hordes === 1 : HORDES.enabledDefault, hordeGraceDays: r?.hordeGraceDays ?? HORDES.graceDaysDefault };
}
/** In-game days since the world clock epoch (fractional). */
export function worldDays(world: World): number {
  const tod = world.env(TimeOfDayLike);
  return tod.dayLengthTicks > 0 ? (world.tick - tod.epochTick) / tod.dayLengthTicks : 0;
}

export interface HordeTarget { key: string; kind: HordeKind; owner: number; members: number; level: number; pieces: Entity[]; x: number; y: number }
interface Horde { id: number; kind: HordeKind; owner: number; key: string; members: Set<Entity>; tx: number; ty: number; target: Entity }
interface Pending { at: number; t: HordeTarget; size: number }
interface HordeRuntime { hordes: Map<number, Horde>; nextId: number; nextTick: number; pending?: Pending | undefined; lastHit: Map<string, number> }
export const HordeRuntimeRes = defineResource<HordeRuntime>("gameplay.HordeRuntime");
export function hordeRuntime(world: World): HordeRuntime {
  let r = world.getResource(HordeRuntimeRes);
  if (!r) world.setResource(HordeRuntimeRes, (r = { hordes: new Map(), nextId: 1, nextTick: 0, lastHit: new Map() }));
  return r;
}

const levelOf = (world: World, e: Entity): number => (world.isRegistered(Progression) ? world.getField(e, Progression, "level") ?? 1 : 1) || 1;
/** Structure groups hordes can target: one per clan (pieces whose Tribe is a clan), per solo builder (PieceOwner),
 *  and ownerless pieces bucketed by 32-tile cell (legacy / reloaded solo builds). */
export function hordeTargets(world: World): HordeTarget[] {
  const reg = world.getResource(Permissions)?.groups;
  const players = new Map<number, Entity>(); if (world.isRegistered(PlayerId)) for (const p of world.query([Survival, PlayerId, Transform], [Dead])) players.set(world.getField(p, PlayerId, "id")!, p);
  const acc = new Map<string, HordeTarget>();
  for (const e of world.query([BuildPiece, Transform], [Dead])) {
    const tribe = world.getField(e, Tribe, "id") ?? 0; const t = world.get(e, Transform)!;
    const clanG = tribe && reg ? reg.get(tribe) : undefined;
    let key: string, kind = HordeKind.Solo, owner = 0;
    if (clanG && clanG.kind === GroupKind.Clan) { key = `c${tribe}`; kind = HordeKind.Clan; owner = tribe; }
    else { owner = world.getField(e, PieceOwner, "player") ?? 0; key = owner ? `p${owner}` : `h${Math.floor(t.x / 32)},${Math.floor(t.y / 32)}`; }
    let g = acc.get(key); if (!g) acc.set(key, (g = { key, kind, owner, members: 1, level: 1, pieces: [], x: 0, y: 0 }));
    g.pieces.push(e); g.x += t.x; g.y += t.y;
  }
  const out: HordeTarget[] = [];
  for (const g of acc.values()) {
    if (g.pieces.length < HORDES.minPiecesPerTarget) continue;
    g.x /= g.pieces.length; g.y /= g.pieces.length;
    if (g.kind === HordeKind.Clan) {
      const grp = reg!.get(g.owner)!; g.members = Math.max(1, grp.members.size);
      const lv = [...grp.members.keys()].map((p) => players.get(p)).filter((e): e is Entity => e !== undefined).map((e) => levelOf(world, e));
      g.level = lv.length ? lv.reduce((a, b) => a + b, 0) / lv.length : 1;
    } else {
      let pe = g.owner ? players.get(g.owner) : undefined;
      if (pe === undefined) { let bd = Infinity; for (const p of players.values()) { const t = world.get(p, Transform)!; const d = Math.hypot(t.x - g.x, t.y - g.y); if (d < bd) { bd = d; pe = p; } } }
      g.level = pe !== undefined ? levelOf(world, pe) : 1;
    }
    out.push(g);
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
/** Grace in days for a target: world grace, times lowLevelGraceMul while its players are below minTargetLevel. */
export const graceFor = (graceDays: number, level: number): number => graceDays * (level >= HORDES.minTargetLevel ? 1 : HORDES.lowLevelGraceMul);

const status = (world: World) => world.get(world.environment, HordeStatus);
function setStatus(world: World, patch: Partial<{ phase: number; seq: number; kind: number; size: number; alive: number; x: number; y: number; owner: number; nextTick: number }>): void {
  const cur = status(world) ?? { phase: 0, seq: 0, kind: 0, size: 0, alive: 0, x: 0, y: 0, owner: 0, nextTick: 0 };
  const next = { ...cur, ...patch };
  if (Object.keys(patch).some((k) => (cur as Record<string, number>)[k] !== (next as Record<string, number>)[k]) || !world.has(world.environment, HordeStatus)) { if (world.has(world.environment, HordeStatus)) world.set(world.environment, HordeStatus, next); else world.add(world.environment, HordeStatus, next); }
}

function walkable(world: World, x: number, y: number): boolean {
  const terrain = world.getResource(TerrainRes); if (!terrain) return true;
  return !terrainBlocksWalker(world, Math.floor(x), Math.floor(y)); // ADR-181: shallow water is walkable
}
function compositionKinds(world: World): { kinds: number[]; weights: number[] } {
  const defs = gameplayDefs(world); const kinds: number[] = [], weights: number[] = [];
  for (const [k, w] of Object.entries(HORDES.composition)) { try { kinds.push(defs.zombieId(k)); weights.push(w); } catch { /* unknown kind */ } }
  return { kinds, weights };
}
/** Spawns a horde of `size` toward target group t. Returns the horde id (0 when nothing could spawn). */
export function spawnHorde(world: World, t: HordeTarget, size: number): number {
  const rt = hordeRuntime(world); const rng = world.rngFor("horde", rt.nextId);
  const target = t.pieces.reduce((best, e) => { const a = world.get(e, Transform)!, b = world.get(best, Transform)!; return Math.hypot(a.x - t.x, a.y - t.y) < Math.hypot(b.x - t.x, b.y - t.y) ? e : best; }, t.pieces[0]!);
  let cx = t.x, cy = t.y, ok = false;
  for (let i = 0; i < 12 && !ok; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(HORDES.spawnRingMin, HORDES.spawnRingMax);
    cx = t.x + Math.cos(a) * r; cy = t.y + Math.sin(a) * r; ok = walkable(world, cx, cy);
  }
  if (!ok) return 0;
  const { kinds, weights } = compositionKinds(world); if (!kinds.length) return 0;
  const total = weights.reduce((a, b) => a + b, 0); const id = rt.nextId++; const members = new Set<Entity>();
  const tt = world.get(target, Transform)!;
  for (let n = 0; n < size; n++) {
    let roll = rng.range(0, total), kind = kinds[0]!; for (let i = 0; i < kinds.length; i++) { roll -= weights[i]!; if (roll <= 0) { kind = kinds[i]!; break; } }
    const x = cx + rng.range(-3, 3), y = cy + rng.range(-3, 3); if (!walkable(world, x, y)) continue;
    const z = spawnZombie(world, kind, x, y, 0);
    world.add(z, HordeMember, { horde: id & 0xffff, target, tx: tt.x, ty: tt.y });
    world.setField(z, ZombieBrain, "goalX", tt.x); world.setField(z, ZombieBrain, "goalY", tt.y); world.setField(z, ZombieBrain, "state", ZState.Chase);
    members.add(z);
  }
  if (!members.size) return 0;
  rt.hordes.set(id, { id, kind: t.kind, owner: t.owner, key: t.key, members, tx: tt.x, ty: tt.y, target });
  return id;
}
const aliveIn = (world: World, h: Horde): number => { for (const z of [...h.members]) if (!world.isAlive(z) || world.has(z, Dead) || !world.has(z, HordeMember)) h.members.delete(z); return h.members.size; };

/** Server director (every HORDES_EVERY ticks). */
export function hordeDirectorSystem(world: World, dt = 1 / 20): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const rules = worldRules(world); const rt = hordeRuntime(world);
  // bookkeeping
  let alive = 0;
  for (const h of [...rt.hordes.values()]) { const n = aliveIn(world, h); alive += n; if (n === 0) rt.hordes.delete(h.id); }
  const st = status(world);
  if (st && st.phase === HordePhase.Active) {
    const cur = [...rt.hordes.values()].reduce((s, h) => s + h.members.size, 0);
    if (rt.hordes.size === 0) setStatus(world, { phase: HordePhase.Idle, alive: 0 }); else if (st.alive !== cur) setStatus(world, { alive: cur });
  }
  if (!rules.hordes) { rt.pending = undefined; if (st && st.phase === HordePhase.Warning) setStatus(world, { phase: HordePhase.Idle }); return; }
  const len = world.env(TimeOfDayLike).dayLengthTicks; if (len <= 0) return;
  if (rt.nextTick === 0) rt.nextTick = world.tick + Math.round(len * HORDES.intervalDays * 0.5);
  // warning elapsed -> spawn
  if (rt.pending && world.tick >= rt.pending.at) {
    const p = rt.pending; rt.pending = undefined;
    const size = Math.min(p.size, HORDES.maxHordeZombies - alive);
    const id = size >= 2 ? spawnHorde(world, p.t, size) : 0;
    if (id) { rt.lastHit.set(p.t.key, world.tick); setStatus(world, { phase: HordePhase.Active, size: rt.hordes.get(id)!.members.size, alive: alive + rt.hordes.get(id)!.members.size }); }
    else setStatus(world, { phase: rt.hordes.size ? HordePhase.Active : HordePhase.Idle });
    return;
  }
  if (rt.pending || world.tick < rt.nextTick || rt.hordes.size >= HORDES.maxActiveHordes || alive >= HORDES.maxHordeZombies - 2) return;
  if (!HORDES.phases.includes(currentPhaseKey(world))) return;
  const days = worldDays(world); if (days < rules.hordeGraceDays) return;
  const eligible = hordeTargets(world).filter((t) => days >= graceFor(rules.hordeGraceDays, t.level) && ![...rt.hordes.values()].some((h) => h.key === t.key));
  if (!eligible.length) return;
  eligible.sort((a, b) => (rt.lastHit.get(a.key) ?? -1) - (rt.lastHit.get(b.key) ?? -1) || (a.key < b.key ? -1 : 1));
  const t = eligible[0]!;
  const size = Math.min(hordeSize({ clan: t.kind === HordeKind.Clan, members: t.members, level: t.level, daysPastGrace: days - graceFor(rules.hordeGraceDays, t.level) }), HORDES.maxHordeZombies - alive);
  const at = world.tick + Math.max(1, secondsToTicks(HORDES.warnSeconds, dt));
  rt.pending = { at, t, size }; rt.nextTick = world.tick + Math.round(len * HORDES.intervalDays);
  setStatus(world, { phase: HordePhase.Warning, seq: ((st?.seq ?? 0) + 1) & 0xffff, kind: t.kind, size, alive: 0, x: t.x, y: t.y, owner: t.owner, nextTick: at });
}
/** Test/dev hook: start a horde against target `t` immediately (no warning). */
export function forceHorde(world: World, t: HordeTarget, size?: number): number {
  const n = size ?? hordeSize({ clan: t.kind === HordeKind.Clan, members: t.members, level: t.level });
  const id = spawnHorde(world, t, n);
  if (id) { const st = status(world); setStatus(world, { phase: HordePhase.Active, seq: ((st?.seq ?? 0) + 1) & 0xffff, kind: t.kind, size: n, alive: hordeRuntime(world).hordes.get(id)!.members.size, x: t.x, y: t.y, owner: t.owner }); }
  return id;
}
export const _hordeInternal = { Zombie };
