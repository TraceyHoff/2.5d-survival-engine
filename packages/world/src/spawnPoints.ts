/**
 * Four deterministic world spawn points (ADR-106): one per quadrant around the origin, all on the starter biome
 * (grass band by default), each centred on a clear patch (every tile the same walkable biome, no generated resource
 * node), pushed as far out along its quadrant diagonal as the search window allows so pairwise distances are maximal.
 * Pure function of the generator (= world seed): every peer and every restart computes the same four points.
 */
import { CHUNK_SIZE } from "./chunk.js";
import type { ProceduralGenerator } from "./generator.js";

export interface SpawnPoint { x: number; y: number }
export interface SpawnPointOptions {
  /** Quadrant centre distance from the origin along each axis, in tiles (default 96). */
  radius?: number;
  /** Starter biome tile id (default 3 = grass). */
  tile?: number;
  /** Fallback tiles accepted when a quadrant has no starter-biome patch (default sand/forest: 2, 4). */
  fallbackTiles?: readonly number[];
  /** Half-size of the clear patch around the point, in tiles (default 2 → 5x5). */
  clear?: number;
  /** Candidate grid step in tiles (default 4). */
  step?: number;
}
/** Quadrant order: NE (+x,-y), SE (+x,+y), SW (-x,+y), NW (-x,-y). */
export const SPAWN_QUADRANTS: readonly (readonly [number, number])[] = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

export function computeSpawnPoints(gen: ProceduralGenerator, o: SpawnPointOptions = {}): SpawnPoint[] {
  const R = o.radius ?? 96, tile = o.tile ?? 3, clear = o.clear ?? 2, step = o.step ?? 4;
  const nodeChunks = new Map<string, Set<number>>();
  const hasNode = (tx: number, ty: number): boolean => {
    const cx = Math.floor(tx / CHUNK_SIZE), cy = Math.floor(ty / CHUNK_SIZE), k = `${cx},${cy}`;
    let set = nodeChunks.get(k);
    if (!set) { set = new Set(); for (const n of gen.load(cx, cy).nodes) set.add((n.ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (n.tx - cx * CHUNK_SIZE)); nodeChunks.set(k, set); }
    return set.has((ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE));
  };
  const clearPatch = (tx: number, ty: number, want: number): boolean => {
    for (let dy = -clear; dy <= clear; dy++) for (let dx = -clear; dx <= clear; dx++) if (gen.tileAt(tx + dx, ty + dy) !== want) return false;
    for (let dy = -clear; dy <= clear; dy++) for (let dx = -clear; dx <= clear; dx++) if (hasNode(tx + dx, ty + dy)) return false;
    return true;
  };
  return SPAWN_QUADRANTS.map(([sx, sy]) => {
    for (const want of [tile, ...(o.fallbackTiles ?? [2, 4])]) {
      let best: { tx: number; ty: number; score: number } | undefined;
      // window [R/2, 3R/2] on both axes of this quadrant; score = distance outward along the diagonal, then closeness to it
      for (let j = Math.ceil(R / 2); j <= Math.floor(R * 1.5); j += step) for (let i = Math.ceil(R / 2); i <= Math.floor(R * 1.5); i += step) {
        const score = (i + j) * 1024 - Math.abs(i - j);
        if (best && score <= best.score) continue;
        const tx = sx * i, ty = sy * j; if (clearPatch(tx, ty, want)) best = { tx, ty, score };
      }
      if (best) return { x: best.tx + 0.5, y: best.ty + 0.5 };
    }
    return { x: sx * R + 0.5, y: sy * R + 0.5 };
  });
}
