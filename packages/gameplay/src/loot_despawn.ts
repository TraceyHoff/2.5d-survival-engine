/**
 * ADR-238 ground-item despawn. Every LootBag (dropped stacks, death bags, thrown weapons, creature loot, stall
 * returns) stores its ABSOLUTE spawn tick + kind, and the authority derives the expiry from them, so timers survive
 * save/load and server restarts (world.tick persists in WorldMeta). Rules (values: pvp.json "despawn"):
 *  - lifetime by kind: dropped 10 min, death bag 30 min (thrown 5 min, creature loot 2 min, stall returns 10 min);
 *  - opening / partially looting a bag never resets anything; a bag looted down to EMPTY gets `emptiedTick` and
 *    goes `emptiedSeconds` later (refilled before that: the grace is cancelled);
 *  - safety cap `maxGroundBags`: past it the OLDEST non-permanent bags are scheduled out first (they get the normal last-`fadeSeconds` fade), but a
 *    death bag younger than `deathBagMinAgeSeconds` never is (the cap may overflow rather than eat a fresh corpse run);
 *  - permanent caches (despawnAtTick 0xffffffff, e.g. the sandbox crate) never time out.
 * Clients read the replicated fields for the last-`fadeSeconds` sprite fade + a dust puff on removal.
 */
import type { Entity, World } from "@engine/core";
import { Transform } from "@engine/core";
import raw from "../data/pvp.json";
import { Container, LootBag } from "./components.js";
import { isAuthority } from "./config.js";
import { secondsToTicks } from "./defs.js";
import { emit, ev } from "./events.js";
import { listSlots } from "./inventory.js";
import { LootSource, type LootSourceId } from "./loot_labels.js";

export interface DespawnTuning {
  droppedSeconds: number; deathBagSeconds: number; thrownSeconds: number; creatureLootSeconds: number; stallBagSeconds: number;
  emptiedSeconds: number; fadeSeconds: number; maxGroundBags: number; deathBagMinAgeSeconds: number;
  /** Lifetime every pre-ADR-238 bag was created with (spawn tick of legacy saves = despawnAtTick - this). */
  legacyBagSeconds: number;
}
export const DESPAWN: Readonly<DespawnTuning> = Object.freeze({ ...(raw as unknown as { despawn: DespawnTuning }).despawn });
const DT = 1 / 20;
const T = (s: number): number => secondsToTicks(s, DT);
/** LootBag.despawnAtTick of a permanent cache (never times out). */
export const PERMANENT_DESPAWN = 0xffffffff;
export type LootBagKind = "dropped" | "death" | "thrown" | "creature" | "stall" | "petDeath";
const LIFE: Record<LootBagKind, () => number> = {
  dropped: () => DESPAWN.droppedSeconds, death: () => DESPAWN.deathBagSeconds, thrown: () => DESPAWN.thrownSeconds,
  creature: () => DESPAWN.creatureLootSeconds, stall: () => DESPAWN.stallBagSeconds, petDeath: () => DESPAWN.deathBagSeconds,
};
/** LootBag init for a new ground bag: absolute spawn tick, its kind (LootSource) and the derived expiry. */
export function lootBagInit(world: World, owner: number, life: LootBagKind, source: LootSourceId): { owner: number; despawnAtTick: number; spawnTick: number; kind: number; emptiedTick: number } {
  const now = world.tick >>> 0;
  return { owner, despawnAtTick: Math.min(PERMANENT_DESPAWN - 1, now + T(LIFE[life]())), spawnTick: now, kind: source || LootSource.Dropped, emptiedTick: 0 };
}
export interface LootBagTimes { spawnTick: number; despawnAtTick: number; emptiedTick: number; kind: number; owner: number }
export const isPermanentBag = (b: { despawnAtTick: number }): boolean => b.despawnAtTick >>> 0 === PERMANENT_DESPAWN;
/** Spawn tick; legacy (pre-ADR-238, kind 0) bags derive it from their old fixed lifetime. */
export const bagSpawnTick = (b: LootBagTimes): number => (b.kind ? b.spawnTick : Math.max(0, b.despawnAtTick - T(DESPAWN.legacyBagSeconds)));
/** Tick the bag goes: its timer, or emptiedTick + emptied grace, whichever is first. PERMANENT_DESPAWN = never. */
export function bagExpiryTick(b: LootBagTimes): number {
  const emptied = b.emptiedTick ? b.emptiedTick + T(DESPAWN.emptiedSeconds) : Infinity;
  if (isPermanentBag(b)) return Number.isFinite(emptied) ? emptied : PERMANENT_DESPAWN;
  return Math.min(b.despawnAtTick, emptied);
}
/** A death bag (or a legacy owner-tagged bag) still inside its protection window: the cap never takes it. */
export const capProtected = (b: LootBagTimes, tick: number): boolean =>
  (b.kind === LootSource.Death || (b.kind === 0 && b.owner !== 0)) && tick - bagSpawnTick(b) < T(DESPAWN.deathBagMinAgeSeconds);
/**
 * Client fade (pure): sprite alpha for a bag at `tick` (fractional ok). 1 until the last fade window, then an eased
 * fall to `floor` with a slow, shallow breathing (no blink); the window is `fadeSeconds`, or the whole emptied grace.
 */
export function despawnFadeAlpha(b: LootBagTimes, tick: number, floor = 0.25): number {
  const exp = bagExpiryTick(b); if (exp >= PERMANENT_DESPAWN) return 1;
  const left = (exp - tick) * DT; const win = b.emptiedTick && exp !== b.despawnAtTick ? DESPAWN.emptiedSeconds : DESPAWN.fadeSeconds;
  if (left >= win) return 1; if (left <= 0) return floor;
  const u = 1 - left / win; const ease = u * u * (3 - 2 * u); // smoothstep 0..1
  const breathe = 0.06 * Math.sin(tick * DT * Math.PI) * ease; // ~0.5 Hz, 6 % peak: a pulse you notice, never a blink
  return Math.max(floor, Math.min(1, 1 - (1 - floor) * ease + breathe));
}

export const LootBagDespawned = ev<{ bag: Entity; x: number; y: number; z: number; kind: number; reason: "expired" | "emptied" }>("gameplay.LootBagDespawned");

const isEmpty = (world: World, b: Entity): boolean => world.has(b, Container) && listSlots(world, b).every((s) => !s.item || !s.count);
/** postSim "gameplay.lootBags" (every 20 ticks): emptied bookkeeping, expiry, then the ground cap. */
export function lootBagDespawnSystem(world: World): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const now = world.tick; const live: { b: Entity; spawn: number; prot: boolean }[] = [];
  for (const b of [...world.query([LootBag])].sort((a, c) => a - c)) {
    const lb = world.get(b, LootBag)!;
    const empty = isEmpty(world, b);
    if (empty && !lb.emptiedTick) { lb.emptiedTick = Math.max(1, now); world.setField(b, LootBag, "emptiedTick", lb.emptiedTick); }
    else if (!empty && lb.emptiedTick) { lb.emptiedTick = 0; world.setField(b, LootBag, "emptiedTick", 0); } // refilled: grace cancelled
    const exp = bagExpiryTick(lb);
    if (exp < PERMANENT_DESPAWN && now >= exp) { despawn(world, b, lb.kind, lb.emptiedTick && exp !== lb.despawnAtTick ? "emptied" : "expired"); continue; }
    if (isPermanentBag(lb) || exp - now <= T(DESPAWN.fadeSeconds)) continue; // permanent / already on its way out
    live.push({ b, spawn: bagSpawnTick(lb), prot: capProtected(lb, now) });
  }
  let over = live.length - Math.max(0, DESPAWN.maxGroundBags | 0); if (over <= 0) return;
  live.sort((a, c) => a.spawn - c.spawn || a.b - c.b); // oldest first
  const at = now + T(DESPAWN.fadeSeconds);
  for (const x of live) { if (over <= 0) break; if (x.prot) continue; world.setField(x.b, LootBag, "despawnAtTick", at); over--; } // normal fade + puff, then gone
}
function despawn(world: World, b: Entity, kind: number, reason: "expired" | "emptied"): void {
  const t = world.get(b, Transform); emit(world, LootBagDespawned, { bag: b, x: t?.x ?? 0, y: t?.y ?? 0, z: t?.z ?? 0, kind, reason }); world.destroy(b);
}
