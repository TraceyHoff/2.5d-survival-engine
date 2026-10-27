/**
 * ADR-197: neighbour-aware side-face culling for deck pieces (foundations, floors), plus a total depth order for
 * structure pieces. Shared by the WebGL2 sprite pipeline (vertex/fragment shader mirror) and the Canvas2D renderer.
 *
 * The art is one sprite per piece: a top diamond (at DECK_TOP_PX above the ground) with skirt and rim pixels around it.
 * Rather than needing split art, every pixel is projected onto the piece's top plane, giving tile offsets (a, b) from
 * the footprint centre. A pixel past the +x edge (a > fw/2) belongs to the +x side: its skirt below the edge, or its rim
 * beyond it. It is drawn only when that side is OPEN, meaning no deck at the same level with the same or a taller top
 * covers the whole side. The covered region is exactly where the neighbour's own top or skirt draws, so a base shows
 * only its outward faces.
 */
import { DECK_TOP_PX } from "./deckTops.generated.js";

export const SIDE_PX = 1, SIDE_PY = 2, SIDE_NX = 4, SIDE_NY = 8;
/** Tolerance (tiles) past the shared edge that stays visible: the edge's own anti-aliased pixel row. */
export const DECK_EDGE_EPS = 0.02;
/** Neighbour counts as "same or taller" within this many px of top height. */
const TOP_TOL = 0.5;

/** Top-face height (px above ground) of a deck sprite by manifest key; undefined = not a slab (no culling). */
export const deckTopPx = (spriteKey: string | undefined): number | undefined => (spriteKey === undefined ? undefined : DECK_TOP_PX[spriteKey]);

const cellKey = (x: number, y: number, level: number): number => ((x + 32768) * 65536 + (y + 32768)) * 64 + (level & 63);

/** Per-frame map of deck cells (non-ghost) -> tallest top height at that cell and level. */
export class DeckNeighbors {
  private readonly tops = new Map<number, number>();
  clear(): void { this.tops.clear(); }
  get size(): number { return this.tops.size; }
  add(ax: number, ay: number, fw: number, fh: number, level: number, top: number): void {
    for (let y = ay; y < ay + fh; y++) for (let x = ax; x < ax + fw; x++) { const k = cellKey(x, y, level); const o = this.tops.get(k); if (o === undefined || top > o) this.tops.set(k, top); }
  }
  private covered(x: number, y: number, level: number, top: number): boolean { const t = this.tops.get(cellKey(x, y, level)); return t !== undefined && t >= top - TOP_TOL; }
  /** Bit set of CLOSED sides (a deck neighbour covers the whole side). */
  mask(ax: number, ay: number, fw: number, fh: number, level: number, top: number): number {
    let px = true, nx = true, py = true, ny = true;
    for (let y = ay; y < ay + fh; y++) { px &&= this.covered(ax + fw, y, level, top); nx &&= this.covered(ax - 1, y, level, top); }
    for (let x = ax; x < ax + fw; x++) { py &&= this.covered(x, ay + fh, level, top); ny &&= this.covered(x, ay - 1, level, top); }
    return (px ? SIDE_PX : 0) | (py ? SIDE_PY : 0) | (nx ? SIDE_NX : 0) | (ny ? SIDE_NY : 0);
  }
}

/** Screen offset (dx, dy px from the footprint-centre pivot) -> tile offsets (a, b) on the top plane `top` px up. */
export function deckTileOffset(dx: number, dy: number, top: number, hw: number, hh: number): [number, number] {
  const d = dy + top; return [(dx / hw + d / hh) / 2, (d / hh - dx / hw) / 2];
}
/** Is a pixel at tile offset (a, b) kept? (CPU mirror of the fragment shader test.) */
export function deckKeep(a: number, b: number, fw: number, fh: number, mask: number): boolean {
  const ha = fw / 2 + DECK_EDGE_EPS, hb = fh / 2 + DECK_EDGE_EPS;
  return !((mask & SIDE_PX && a > ha) || (mask & SIDE_PY && b > hb) || (mask & SIDE_NX && a < -ha) || (mask & SIDE_NY && b < -hb));
}
/** Keep region as a screen polygon around the pivot (Canvas2D clip): the top-plane rectangle, unbounded on open sides. */
export function deckClipPolygon(fw: number, fh: number, mask: number, top: number, hw: number, hh: number): [number, number][] {
  const B = 64; const ha = fw / 2 + DECK_EDGE_EPS, hb = fh / 2 + DECK_EDGE_EPS;
  const a0 = mask & SIDE_NX ? -ha : -B, a1 = mask & SIDE_PX ? ha : B, b0 = mask & SIDE_NY ? -hb : -B, b1 = mask & SIDE_PY ? hb : B;
  const p = (a: number, b: number): [number, number] => [(a - b) * hw, (a + b) * hh - top];
  return [p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1)];
}

/**
 * Unique depth tie-break for structure pieces whose keys would otherwise be equal. Pieces in the same iso row
 * (x + y) that sit side by side differ in (x - y) by 1..3 cells, so (x - y) mod 4 separates them. A ghost always sits
 * just in front of the placed piece it overlaps. The maximum (0.0064) stays below the per-layer bias (0.01).
 */
export const PIECE_TB_STEP = 0.0008, GHOST_TB = 0.004;
export const pieceTieBreak = (ax: number, ay: number, ghost: boolean): number => ((((ax - ay) % 4) + 4) % 4) * PIECE_TB_STEP + (ghost ? GHOST_TB : 0);
/** Total order for equal keys (static chunk sort, Canvas2D painter): level, layer, y, x. */
export const pieceOrder = (level: number, layer: number, ax: number, ay: number): number => ((level & 63) * 16 + (layer & 15)) * 1e10 + (ay + 32768) * 65536 + (ax + 32768);
