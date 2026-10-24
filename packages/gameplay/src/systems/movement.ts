/**
 * Player movement (moved from apps/server protocol.ts). Same function on the server and in client prediction:
 * screen-aligned iso directions from action bits (GameplayActions MoveUp/Down/Left/Right/Sprint occupy bits 0..4,
 * identical to the demo protocol), speed = walkSpeed x sprintMul (sprinting with stamina) x encumbrance x wetness x
 * MoveSpeed buffs. Sprint stamina drain happens in vitalsSystem from PlayerIntent.moving/sprint. Movement is blocked
 * by edge walls/closed doors, solid cell pieces at the player's level and unwalkable terrain (per-axis slide).
 */
import { entityIndex, evaluate, Transform, type Entity, type World } from "@engine/core";
import { Buffs, Dead, Driver, EdgeSide, Inventory, PlayerIntent, Stat, Survival, Wetness } from "../components.js";
import { gameplayDefs } from "../config.js";
import { GameplayActions as A } from "../input.js";
import { StructureIndexRes } from "../building/structure.js";
import { TerrainRes } from "../world.js";

/** Unit-speed iso direction from action bits (W = up-screen = -x -y), normalized on diagonals. */
export function moveDirection(actions: number): { dx: number; dy: number } {
  let dx = 0, dy = 0;
  if (actions & A.MoveUp) { dx -= 1; dy -= 1; }
  if (actions & A.MoveDown) { dx += 1; dy += 1; }
  if (actions & A.MoveLeft) { dx -= 1; dy += 1; }
  if (actions & A.MoveRight) { dx += 1; dy -= 1; }
  if (dx && dy) { const k = Math.SQRT1_2; dx *= k; dy *= k; }
  return { dx, dy };
}

/** Current speed multiplier from sprint/encumbrance/wetness/buffs (tiles/s = walkSpeed x this). */
export function speedMultiplier(world: World, e: Entity, sprint: boolean): number {
  const mv = gameplayDefs(world).movement; let m = 1;
  if (sprint && (world.getField(e, Survival, "stamina") ?? 0) > 0) m *= mv.sprintMul;
  const max = world.getField(e, Inventory, "maxWeight") ?? 0; const w = world.getField(e, Inventory, "weight") ?? 0;
  if (max > 0) { const f = w / max; if (f > mv.encumberedFrom) m *= 1 - (1 - mv.encumberedMinMul) * Math.min(1, (f - mv.encumberedFrom) / (1 - mv.encumberedFrom)); }
  m *= 1 - mv.wetSlowMul * ((world.getField(e, Wetness, "level") ?? 0) / 255);
  return evaluate(world, e, Buffs, Stat.MoveSpeed, m);
}

/** Movement collision query (terrain, edge walls/doors, solid cells); vehicles reuse it per footprint corner. */
export function movementBlocked(world: World, x0: number, y0: number, x1: number, y1: number, level: number): boolean {
  const defs = gameplayDefs(world); const terrain = world.getResource(TerrainRes);
  const tx0 = Math.floor(x0), ty0 = Math.floor(y0), tx1 = Math.floor(x1), ty1 = Math.floor(y1);
  if (terrain && defs.worldgen.unwalkableTiles.has(terrain.tileAt(tx1, ty1))) return true;
  const idx = world.getResource(StructureIndexRes); if (!idx || idx.count === 0) return false;
  if (tx1 !== tx0 && idx.edgeBlocker(Math.max(tx0, tx1), ty0, level, EdgeSide.West)) return true;
  if (ty1 !== ty0 && idx.edgeBlocker(tx1, Math.max(ty0, ty1), level, EdgeSide.North)) return true;
  if (tx1 !== tx0 || ty1 !== ty0) for (let la = 1; la < 4; la++) { const c = idx.cell(tx1, ty1, level, la); if (c && idx.def(c)?.solid) return true; }
  return false;
}

/** Applies one tick of movement input (server authority + client prediction). Writes PlayerIntent.moving/sprint. */
export function applyMovementInput(world: World, e: Entity, actions: number, dt: number): void {
  const t = world.get(e, Transform); if (!t) return;
  if (world.has(e, Driver)) return; // riders move with their vehicle (gameplay.vehicles)
  const dead = world.has(e, Dead);
  const { dx, dy } = dead ? { dx: 0, dy: 0 } : moveDirection(actions);
  const moving = dx || dy ? 1 : 0; const sprint = moving && actions & A.Sprint ? 1 : 0;
  if (world.has(e, PlayerIntent)) {
    const st = world.store(PlayerIntent); const i = entityIndex(e); const s = st.slot(i);
    if (st.data.moving[s] !== moving || st.data.sprint[s] !== sprint) { st.data.moving[s] = moving; st.data.sprint[s] = sprint; st.markChanged(i); }
  }
  if (!moving) return;
  const sp = gameplayDefs(world).movement.walkSpeed * speedMultiplier(world, e, sprint === 1) * dt;
  const level = Math.max(0, Math.round(t.z / gameplayDefs(world).building.levelHeight));
  let x = t.x, y = t.y; const nx = x + dx * sp, ny = y + dy * sp;
  if (!movementBlocked(world, x, y, nx, y, level)) x = nx;
  if (!movementBlocked(world, x, y, x, ny, level)) y = ny;
  if (x !== t.x || y !== t.y) world.set(e, Transform, { x, y, facing: Math.atan2(dy, dx) });
}
