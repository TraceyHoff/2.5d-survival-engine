/**
 * Zombie pathing: deterministic A* on the tile grid at level 0, 4-neighbour moves. Crossing an edge with a blocking
 * wall or closed door (or entering a solid cell piece) is allowed at a break cost = ticks to destroy it
 * (hp / damage per hit x cooldown) x breakCostMul, so zombies route through doors/weak walls when that is cheaper
 * than walking around. Unwalkable terrain is impassable. Returns the tile path and the first blocking piece on it.
 */
import type { Entity, World } from "@engine/core";
import { BuildPiece, EdgeSide } from "../components.js";
import { gameplayDefs } from "../config.js";
import { StructureIndexRes, type StructureIndex } from "../building/structure.js";
import { TerrainRes } from "../world.js";

export interface PathResult { tiles: [number, number][]; blocker: Entity | 0; blockerIndex: number; cost: number }

/** Blocker when stepping from (x,y) to (nx,ny) at level 0: edge wall/door between them, or a solid cell at the destination. */
export function stepBlocker(idx: StructureIndex | undefined, x: number, y: number, nx: number, ny: number): Entity | 0 {
  if (!idx || idx.count === 0) return 0;
  let e: Entity | 0 = 0;
  if (nx !== x) e = idx.edgeBlocker(Math.max(x, nx), y, 0, EdgeSide.West);
  else e = idx.edgeBlocker(x, Math.max(y, ny), 0, EdgeSide.North);
  if (e) return e;
  for (let la = 1; la < 4; la++) { const c = idx.cell(nx, ny, 0, la); if (c && idx.def(c)?.solid) return c; }
  return 0;
}

class Heap { // binary min-heap of [f, tie, key]
  a: number[][] = [];
  push(v: number[]): void { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(a[p]!, a[i]!)) break; [a[p], a[i]] = [a[i]!, a[p]!]; i = p; } }
  pop(): number[] | undefined {
    const a = this.a; if (!a.length) return undefined; const top = a[0]!; const last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && less(a[l]!, a[m]!)) m = l; if (r < a.length && less(a[r]!, a[m]!)) m = r; if (m === i) break; [a[m], a[i]] = [a[i]!, a[m]!]; i = m; } }
    return top;
  }
}
const less = (x: number[], y: number[]): boolean => x[0]! < y[0]! || (x[0] === y[0] && (x[1]! < y[1]! || (x[1] === y[1] && x[2]! < y[2]!)));

export function findPath(world: World, sx: number, sy: number, gx: number, gy: number, breakTicks: (piece: Entity) => number): PathResult | undefined {
  const ai = gameplayDefs(world).ai; const idx = world.getResource(StructureIndexRes); const terrain = world.getResource(TerrainRes);
  const unwalk = gameplayDefs(world).worldgen.unwalkableTiles; const R = ai.maxSearchRadius;
  const W = 2 * R + 1; const key = (x: number, y: number): number => (y - sy + R) * W + (x - sx + R);
  const g = new Map<number, number>(); const from = new Map<number, number>();
  const h = (x: number, y: number): number => Math.abs(x - gx) + Math.abs(y - gy);
  const heap = new Heap(); const k0 = key(sx, sy); g.set(k0, 0); heap.push([h(sx, sy), 0, k0]);
  let expanded = 0; let best = k0, bestH = h(sx, sy);
  while (expanded < ai.maxExpandedNodes) {
    const top = heap.pop(); if (!top) break;
    const k = top[2]!; const x = (k % W) + sx - R, y = Math.floor(k / W) + sy - R; const gc = g.get(k)!;
    if (top[0]! > gc + h(x, y) + 1e-9) continue;
    expanded++;
    const hh = h(x, y); if (hh < bestH) { bestH = hh; best = k; }
    if (x === gx && y === gy) { best = k; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy; if (Math.abs(nx - sx) > R || Math.abs(ny - sy) > R) continue;
      if (terrain && unwalk.has(terrain.tileAt(nx, ny))) continue;
      const b = stepBlocker(idx, x, y, nx, ny);
      const step = 1 + (b ? breakTicks(b) * ai.breakCostMul : 0);
      const nk = key(nx, ny); const ng = gc + step;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); from.set(nk, k); heap.push([ng + h(nx, ny), h(nx, ny), nk]); }
    }
  }
  const tiles: [number, number][] = [];
  for (let k: number | undefined = best; k !== undefined; k = from.get(k)) tiles.push([(k % W) + sx - R, Math.floor(k / W) + sy - R]);
  tiles.reverse();
  let blocker: Entity | 0 = 0, blockerIndex = -1;
  for (let i = 1; i < tiles.length; i++) { const b = stepBlocker(idx, tiles[i - 1]![0], tiles[i - 1]![1], tiles[i]![0], tiles[i]![1]); if (b) { blocker = b; blockerIndex = i; break; } }
  return { tiles, blocker, blockerIndex, cost: g.get(best) ?? 0 };
}
export const pieceHp = (world: World, e: Entity): number => world.getField(e, BuildPiece, "hp") ?? 0;
