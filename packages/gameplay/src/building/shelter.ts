/**
 * Shelter rules: roof cover from world BuildingGrid.isCovered (decks/roofs above), wind/rain exposure from
 * BuildingGrid.exposure(x, y, z, windDir) (cell walls, roof), combined with the gameplay edge-wall enclosure
 * (thin walls live in the EdgeIndex, not in grid cells): enclosed + covered = fully sheltered.
 */
import type { World } from "@engine/core";
import { buildingOcclusion, type OcclusionFn } from "@engine/world";
import { EdgeSide } from "../components.js";
import { gameplayDefs } from "../config.js";
import { structures, StructureIndexRes } from "./structure.js";

export interface Shelter { covered: boolean; enclosed: boolean; /** 0 (inside a closed roofed room) .. 1 (open sky) */ exposure: number }
const OPEN: Shelter = { covered: false, enclosed: false, exposure: 1 };

export function shelterAt(world: World, x: number, y: number, z: number, windDir?: number): Shelter {
  const idx = world.getResource(StructureIndexRes); if (!idx || idx.count === 0) return OPEN;
  const level = Math.max(0, Math.round(z / gameplayDefs(world).building.levelHeight));
  const tx = Math.floor(x), ty = Math.floor(y);
  const covered = idx.grid.isCovered(tx, ty, level);
  const enc = idx.edgeEnclosure(tx, ty, level);
  if (enc.enclosed && covered) return { covered, enclosed: true, exposure: 0 };
  let e = idx.grid.exposure(x, y, level, windDir);
  if (enc.enclosed) e *= 0.5;
  return { covered, enclosed: enc.enclosed, exposure: e };
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
