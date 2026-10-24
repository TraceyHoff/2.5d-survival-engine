/**
 * World spawn points (ADR-106). The authority installs the seed's four points (`@engine/world` computeSpawnPoints) with
 * `setSpawnPoints`; joins, human bots and respawns then use `pickSpawnPoint`: the least crowded point (players/bots
 * within CROWD_RADIUS), ties broken by a deterministic rngFor stream, plus a small jitter. Without installed points
 * `spawnPoints(world)` falls back to data/pvp.json spawnPoints. `setRespawnLocator` is the bed / claim hook: when it
 * returns a point for a dead player, respawn uses it instead.
 */
import { defineResource, Transform, type Entity, type World } from "@engine/core";
import pvp from "../data/pvp.json";
import { Dead, Survival } from "./components.js";

export interface SpawnPointXY { x: number; y: number }
const SpawnPointsRes = defineResource<{ points: SpawnPointXY[]; respawnAt?: ((e: Entity) => SpawnPointXY | undefined) | undefined }>("gameplay.SpawnPoints");
/** Players within this many tiles of a spawn point count as crowding it. */
export const CROWD_RADIUS = 24;
/** Default jitter radius around the chosen point (tiles; spawn patches are clear for >= 2 tiles). */
export const SPAWN_JITTER = 2;

const state = (world: World) => { let s = world.getResource(SpawnPointsRes); if (!s) { s = { points: [] }; world.setResource(SpawnPointsRes, s); } return s; };
export function setSpawnPoints(world: World, points: readonly SpawnPointXY[]): void { state(world).points = points.map((p) => ({ x: p.x, y: p.y })); }
/** The world's spawn points (installed ones, else the pvp.json fallback). */
export function spawnPoints(world: World): SpawnPointXY[] {
  const s = world.getResource(SpawnPointsRes); return s?.points.length ? s.points.map((p) => ({ ...p })) : pvp.spawnPoints.map((p) => ({ x: p.x, y: p.y }));
}
/** Bed / claim respawn hook: return a point to respawn `e` there, or undefined for a world spawn point. */
export function setRespawnLocator(world: World, fn: ((e: Entity) => SpawnPointXY | undefined) | undefined): void { state(world).respawnAt = fn; }
export function respawnLocation(world: World, e: Entity): SpawnPointXY | undefined { return world.getResource(SpawnPointsRes)?.respawnAt?.(e); }

/** How many live players / human bots (Survival + Transform) stand within CROWD_RADIUS of each point. */
export function spawnCrowding(world: World, points: readonly SpawnPointXY[], exclude?: Entity): number[] {
  const n = points.map(() => 0);
  for (const e of world.query([Survival, Transform], [Dead])) {
    if (e === exclude) continue; const t = world.get(e, Transform)!;
    points.forEach((p, i) => { if (Math.hypot(t.x - p.x, t.y - p.y) <= CROWD_RADIUS) n[i]!++; });
  }
  return n;
}
/** Least-crowded spawn point (deterministic tie-break via world.rngFor(key, salt)) with jitter. */
export function pickSpawnPoint(world: World, key: string, salt = 0, o: { jitter?: number; exclude?: Entity } = {}): SpawnPointXY & { index: number } {
  const pts = spawnPoints(world); const crowd = spawnCrowding(world, pts, o.exclude); const rng = world.rngFor(`spawn:${key}`, salt);
  const min = Math.min(...crowd); const best = pts.map((_, i) => i).filter((i) => crowd[i] === min);
  const index = best[rng.int(0, best.length)]!; const p = pts[index]!; const j = o.jitter ?? SPAWN_JITTER;
  const a = rng.range(0, Math.PI * 2), r = j * Math.sqrt(rng.next());
  return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, index };
}
