/**
 * ADR-226: level-gated zombie kinds (zombies.json `minPlayerLevel`, e.g. Snuffers at 10).
 * Level = the HIGHEST SKILL-TREE LEVEL (ADR-209, the number players see on the skill tabs) of any human player
 * (Progression, alive, not a host-flagged AI human) within `levelRadius` tiles of the spawn point.
 * Server-authoritative: every spawn path (population, legacy spawner, hordes) asks this before spawning a gated kind.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { Dead, Progression } from "../components.js";
import { gameplayDefs } from "../config.js";
import { treesOf } from "../skills/progression.js";
import { isAiHuman } from "../skills/xp.js";

export const DEFAULT_LEVEL_RADIUS = 64;
/** Highest skill-tree level of any human player within r tiles of (x, y); 0 when none. */
export function playerTreeLevelNear(world: World, x: number, y: number, r = DEFAULT_LEVEL_RADIUS): number {
  let best = 0; const r2 = r * r;
  for (const e of world.query([Progression, Transform], [Dead]) as Iterable<Entity>) { // few players: a scan beats index staleness
    const t = world.get(e, Transform)!; if ((t.x - x) ** 2 + (t.y - y) ** 2 > r2 || isAiHuman(world, e)) continue;
    for (const t of treesOf(world, e) ?? []) if (t.level > best) best = t.level;
  }
  return best;
}
/** May zombie kind `kind` spawn at (x, y)? Ungated kinds always may. */
export function zombieKindAllowed(world: World, kind: number | string, x: number, y: number): boolean {
  const defs = gameplayDefs(world); const id = typeof kind === "string" ? defs.zombieId(kind) : kind; const z = defs.zombies.get(id);
  if (!z?.minPlayerLevel) return true;
  return playerTreeLevelNear(world, x, y, z.levelRadius ?? DEFAULT_LEVEL_RADIUS) >= z.minPlayerLevel;
}
/** `kind` if allowed, else the first allowed ungated kind in data order (walker), so hordes keep their size. */
export function gateZombieKind(world: World, kind: number, x: number, y: number): number {
  if (zombieKindAllowed(world, kind, x, y)) return kind;
  const defs = gameplayDefs(world); return defs.zombieKinds.find((k) => !defs.zombies.get(k)?.minPlayerLevel) ?? kind;
}
