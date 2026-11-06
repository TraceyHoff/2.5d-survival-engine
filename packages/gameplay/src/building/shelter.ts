/**
 * Shelter rules: roof cover from world BuildingGrid.isCovered (decks/roofs above), wind/rain exposure from
 * BuildingGrid.exposure(x, y, z, windDir) (cell walls, roof), combined with the gameplay edge-wall enclosure
 * (thin walls live in the EdgeIndex, not in grid cells): enclosed + covered = fully sheltered.
 */
import type { World } from "@engine/core";
import { buildingOcclusion, type OcclusionFn } from "@engine/world";
import { BuildPiece, EdgeSide } from "../components.js";
import { gameplayDefs } from "../config.js";
import { SocketKind } from "../defs.js";
import { structures, StructureIndex, StructureIndexRes } from "./structure.js";

export interface Shelter { covered: boolean; enclosed: boolean; /** 0 (inside a closed roofed room) .. 1 (open sky) */ exposure: number; /** Wall insulation in deg C around the tile (tier-scaled, window walls halved), averaged over the 4 edges. */ insulation: number }

const OPEN: Shelter = { covered: false, enclosed: false, exposure: 1, insulation: 0 };

/** A wall piece for insulation purposes: a wall-family or corner wall, not a wall-mounted decor piece. */
const isWallPiece = (d: { family?: string; features?: { mount?: boolean } } | undefined): boolean =>
  !!d && (d.family === "wall" || d.family === "corner") && !d.features?.mount;

/** Insulation in deg C from one wall: rises 0.75 per material tier, halved when the wall has a window. */
export const WALL_INSULATION_PER_TIER = [0.75, 1.5, 2.25, 3, 3.75];
export function wallInsulationOf(def: { family?: string; opening?: unknown } | undefined, tier: number, hasWindow: boolean): number {
  if (!isWallPiece(def as { family?: string; features?: { mount?: boolean } })) return 0;
  return (WALL_INSULATION_PER_TIER[Math.min(Math.max(tier, 0), WALL_INSULATION_PER_TIER.length - 1)] ?? 1.5) * (hasWindow ? 0.5 : 1);
}

// Task 29: the 4 edge walls around a tile, as (dx, dy, side) offsets — StructureIndex.tileEdges
// allocates 4 fresh arrays per call; this table is shared. Same edges, same order.
const TILE_EDGE_OFFSETS: readonly (readonly [number, number, EdgeSide])[] = [[0, 0, EdgeSide.North], [0, 1, EdgeSide.North], [0, 0, EdgeSide.West], [1, 0, EdgeSide.West]];
/** Wall insulation around a tile at a level: the 4 edge walls' insulation, averaged over the 4 edges. */
export function wallInsulationAt(world: World, x: number, y: number, z: number): number {
  const idx = world.getResource(StructureIndexRes); if (!idx || idx.count === 0) return 0;
  const level = Math.max(0, Math.round(z / gameplayDefs(world).building.levelHeight));
  const tx = Math.floor(x), ty = Math.floor(y);
  let sum = 0;
  for (const [dx, dy, side] of TILE_EDGE_OFFSETS) {
    const w = idx.edge(tx + dx, ty + dy, level, side); if (!w) continue;
    const d = idx.def(w); if (!d) continue;
    const opening = idx.opening(w); const insert = opening ? idx.def(opening) : undefined;
    const hasWindow = d.opening === SocketKind.Window || insert?.fits === SocketKind.Window;
    const tier = world.getField(w, BuildPiece, "tier") ?? 1;
    sum += wallInsulationOf(d, tier, hasWindow);
  }
  return sum / 4;
}

export function shelterAt(world: World, x: number, y: number, z: number, windDir?: number): Shelter {
  const idx = world.getResource(StructureIndexRes); if (!idx || idx.count === 0) return OPEN;
  const level = Math.max(0, Math.round(z / gameplayDefs(world).building.levelHeight));
  const tx = Math.floor(x), ty = Math.floor(y);
  const covered = idx.grid.isCovered(tx, ty, level);
  const enc = idx.edgeEnclosure(tx, ty, level);
  const insulation = wallInsulationAt(world, x, y, z);
  if (enc.enclosed && covered) return { covered, enclosed: true, exposure: 0, insulation };
  let e = idx.grid.exposure(x, y, level, windDir);
  if (enc.enclosed) e *= 0.5;
  return { covered, enclosed: enc.enclosed, exposure: e, insulation };
}

/**
 * Emitter occlusion for the world EmitterIndex: BuildingGrid cell occlusion (world buildingOcclusion) times thin edge
 * walls / closed doors crossed on the segment (gameplay EdgeIndex).
 */
export function structureOcclusion(world: World): OcclusionFn {
  const idx = structures(world); const cells = buildingOcclusion(idx.grid); const lh = gameplayDefs(world).building.levelHeight;
  return (kind, a, b) => {
    const c = cells(kind, a, b); if (c === 0 || idx.edges.size === 0) return c;
    const z = Math.max(0, Math.floor(b.z / lh + 1e-6));
    const d = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.max(1, Math.ceil(d * 3));
    let px = Math.floor(a.x), py = Math.floor(a.y);
    for (let i = 1; i <= n; i++) {
      const x = Math.floor(a.x + ((b.x - a.x) * i) / n), y = Math.floor(a.y + ((b.y - a.y) * i) / n);
      if (x !== px && idx.edgeBlocker(Math.max(x, px), py, z, EdgeSide.West)) return 0;
      if (y !== py && idx.edgeBlocker(x, Math.max(y, py), z, EdgeSide.North)) return 0;
      px = x; py = y;
    }
    return c;
  };
}
