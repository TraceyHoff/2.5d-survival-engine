/**
 * Task 14: territory defense. A player's territory is their tribe's claim (PrivilegeZone pieces; see
 * building/place.ts zonesAt/hasPrivilege). When a hostile zombie stands inside the owner's claim, nearby
 * owned pets and tame farm animals engage it — through the same creature navigation as everything else, so
 * fences still contain defenders (no teleports through them).
 */
import { Transform, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import { Dead, PrivilegeZone, Tamed, Zombie } from "./components.js";
import { tribeOf, zonesAt } from "./building/place.js";

/** Range (tiles) within which an owned pet / tame animal engages a hostile inside its owner's claim. */
export const TERRITORY_DEFEND_RANGE = 8;
/** Generic bite for tame defenders with no species attack (passive farm animals): damage, range, cooldown. */
export const TERRITORY_BITE = { damage: 5, range: 1.0, cooldownSeconds: 1 } as const;

/** True when (x, y) lies inside a claim of `tribe` (tribe 0 owns no territory). */
export function inClaim(world: World, tribe: number, x: number, y: number): boolean {
  if (!tribe) return false;
  return zonesAt(world, x, y).some((z) => world.getField(z, PrivilegeZone, "tribe") === tribe);
}

/** Tribe of a tamed animal's owner (Tamed.owner is the owner entity, not a PlayerId). */
export function tamedOwnerTribe(world: World, e: Entity): number {
  const owner = world.getField(e, Tamed, "owner"); if (owner === undefined) return 0;
  return world.isAlive(owner) ? tribeOf(world, owner) : 0;
}

/** Nearest living zombie within `range` of (x, y) that stands inside `tribe`'s claim. */
export function nearestClaimHostile(world: World, x: number, y: number, range: number, tribe: number): Entity | undefined {
  if (!tribe) return undefined;
  let best: Entity | undefined; let bd = Infinity;
  for (const z of installSpatialIndex(world).queryRadius(x, y, range)) {
    if (!world.has(z, Zombie) || world.has(z, Dead)) continue;
    const t = world.get(z, Transform); if (!t) continue;
    const d = Math.hypot(t.x - x, t.y - y); if (d > range || d >= bd) continue;
    if (!inClaim(world, tribe, t.x, t.y)) continue;
    best = z; bd = d;
  }
  return best;
}
