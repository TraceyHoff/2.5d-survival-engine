/** ADR-265: full-height, bidirectional terrain-face connections. Rendering never changes sim floor levels. */
import type { World } from "@engine/core";
import { terrainDigAt } from "../terrain_depth.js";
import { EdgeSide } from "../components.js";
import { StructureIndexRes, type StructureIndex } from "./structure.js";
import { TerrainRes, type Terrain } from "../world.js";

export function ladderBetween(idx: StructureIndex | undefined, x: number, y: number, nx: number, ny: number): boolean {
  if (!idx || Math.abs(nx - x) + Math.abs(ny - y) !== 1) return false;
  return !!(nx !== x ? idx.ladder(Math.max(x, nx), y, EdgeSide.West) : idx.ladder(x, Math.max(y, ny), EdgeSide.North));
}
/** A ladder spans the entire step, including a 25-level pit. Diagonal shortcuts cannot bypass a face. */
export function terrainStepBlocked(terrain: Terrain | undefined, idx: StructureIndex | undefined, x: number, y: number, nx: number, ny: number, world = idx?.world): boolean {
  if (!terrain || (x === nx && y === ny)) return false;
  // Do not retroactively turn every generated slope into a wall. Shovel-made pits/pads
  // introduce the new barriers; natural surface walking retains its existing contract.
  if (world && !terrainDigAt(world, x, y) && !terrainDigAt(world, nx, ny)) return false;
  if (Math.abs(terrain.heightAt(x, y) - terrain.heightAt(nx, ny)) <= 1) return false;
  return !ladderBetween(idx, x, y, nx, ny);
}
export function terrainMoveBlocked(world: World, x: number, y: number, nx: number, ny: number): boolean {
  const terrain = world.getResource(TerrainRes), idx = world.getResource(StructureIndexRes);
  // Match per-axis body movement, including diagonal path probes.
  return terrainStepBlocked(terrain, idx, x, y, nx, y, world) || terrainStepBlocked(terrain, idx, nx, y, nx, ny, world);
}
