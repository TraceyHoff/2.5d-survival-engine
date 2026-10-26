/**
 * ADR-162 surface decor. Pieces with `surface.height` (tables, counters, desks, shelves, crates...) hold `small`
 * decor (vases, candles, books, pots...): a small piece whose point lies on a surface piece's footprint at the same
 * level sits at z = level * levelHeight + surface height. Heights stay below levelHeight / 2, so round(z / lh) still
 * gives the level and persistence (level + quarter-tile x/y) needs no format change: placePiece re-derives the z.
 * Removing / destroying a surface drops its decor back onto the floor (or the next surface underneath).
 */
import { Transform, type Entity, type World } from "@engine/core";
import { gameplayDefs } from "../config.js";
import { structures } from "./structure.js";

const EPS = 1e-3;
const SURFACE_LAYER = 2, SMALL_LAYER = 3; // furniture / small decor occupancy layers (they share tiles)

/** Surface height (above the level floor) of the furniture occupying tile (floor x, floor y) at `level`, ignoring `skip`; 0 = none. */
export function surfaceHeightAt(world: World, x: number, y: number, level: number, skip?: Entity): number {
  const idx = structures(world); const e = idx.cell(Math.floor(x), Math.floor(y), level, SURFACE_LAYER);
  if (!e || e === skip) return 0; return idx.def(e)?.surfaceHeight ?? 0;
}
/** World z for a small piece at (x,y) on `level` (floor + surface height when one is under it). */
export function smallPieceZ(world: World, x: number, y: number, level: number, skip?: Entity): number {
  return level * gameplayDefs(world).building.levelHeight + surfaceHeightAt(world, x, y, level, skip);
}
/** Small pieces sharing the footprint tiles of surface piece `s` at its level. */
export function smallPiecesOn(world: World, s: Entity): Entity[] {
  const idx = structures(world); const sl = idx.slotOf(s); if (!sl) return [];
  const out = new Set<Entity>();
  for (const [x, y] of idx.tilesOf(s)) { const e = idx.cell(x, y, sl.z, SMALL_LAYER); if (e && idx.def(e)?.small) out.add(e); }
  return [...out].sort((a, b) => a - b);
}
/** Re-seat small decor on surface `s` (after it is placed, or with skip = s before it is removed). Authority writes z. */
export function reseatSmallOn(world: World, s: Entity, skip?: Entity): void {
  const idx = structures(world);
  for (const e of smallPiecesOn(world, s)) {
    const t = world.get(e, Transform)!; const z = smallPieceZ(world, t.x, t.y, idx.slotOf(e)!.z, skip);
    if (Math.abs(z - t.z) > EPS) world.set(e, Transform, { z });
  }
}
