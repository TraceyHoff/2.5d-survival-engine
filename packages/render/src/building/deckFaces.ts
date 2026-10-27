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
/**
 * ADR-210 connected-texture tops: pixels within DECK_SEAM_BAND tiles of a CLOSED side (bevel, outline, edge shading)
 * are resampled DECK_SEAM_SHIFT tiles toward the interior, so neighbouring decks read as one slab; only open
 * (perimeter) sides keep their edge art. BAND < SHIFT < half a tile keeps the source inside the plain interior.
 */
export const DECK_SEAM_BAND = 0.16, DECK_SEAM_SHIFT = 0.3;
/** Top-plane shift (da, db) applied to a pixel at (a, b) by the seam remap (CPU mirror of the shader). */
export function deckSeamShift(a: number, b: number, fw: number, fh: number, mask: number): [number, number] {
  const ia = fw / 2 - DECK_SEAM_BAND, ib = fh / 2 - DECK_SEAM_BAND;
  const da = mask & SIDE_PX && a > ia ? -DECK_SEAM_SHIFT : mask & SIDE_NX && a < -ia ? DECK_SEAM_SHIFT : 0;
  const db = mask & SIDE_PY && b > ib ? -DECK_SEAM_SHIFT : mask & SIDE_NY && b < -ib ? DECK_SEAM_SHIFT : 0;
  return [da, db];
}
/** Canvas2D seam patches: [clip polygon (screen, around pivot), screen shift dx, dy] per closed side and closed corner. */
export function deckSeamPatches(fw: number, fh: number, mask: number, top: number, hw: number, hh: number): { poly: [number, number][]; dx: number; dy: number }[] {
  const ha = fw / 2 + DECK_EDGE_EPS, hb = fh / 2 + DECK_EDGE_EPS, ia = fw / 2 - DECK_SEAM_BAND, ib = fh / 2 - DECK_SEAM_BAND, S = DECK_SEAM_SHIFT;
  const p = (a: number, b: number): [number, number] => [(a - b) * hw, (a + b) * hh - top];
  const sc = (da: number, db: number): [number, number] => [(da - db) * hw, (da + db) * hh];
  const out: { poly: [number, number][]; dx: number; dy: number }[] = [];
  const strip = (a0: number, a1: number, b0: number, b1: number, da: number, db: number): void => { const [dx, dy] = sc(da, db); out.push({ poly: [p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1)], dx, dy }); };
  if (mask & SIDE_PX) strip(ia, ha, -hb, hb, -S, 0);
  if (mask & SIDE_NX) strip(-ha, -ia, -hb, hb, S, 0);
  if (mask & SIDE_PY) strip(-ha, ha, ib, hb, 0, -S);
  if (mask & SIDE_NY) strip(-ha, ha, -hb, -ib, 0, S);
  for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const ca = sa > 0 ? SIDE_PX : SIDE_NX, cb = sb > 0 ? SIDE_PY : SIDE_NY; if (!(mask & ca) || !(mask & cb)) continue;
    strip(sa > 0 ? ia : -ha, sa > 0 ? ha : -ia, sb > 0 ? ib : -hb, sb > 0 ? hb : -ib, -sa * S, -sb * S);
  }
  return out;
}
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
  /** Tallest deck top (px) at one cell, 0 when none. */
  topAt(x: number, y: number, level: number): number { return this.tops.get(cellKey(x, y, level)) ?? 0; }
  /** ADR-210 deck-top lift for an upright on a footprint: the tallest deck top under it (0 = on the ground). */
  topOver(ax: number, ay: number, fw: number, fh: number, level: number): number {
    let m = 0; for (let y = ay; y < ay + fh; y++) for (let x = ax; x < ax + fw; x++) m = Math.max(m, this.topAt(x, y, level)); return m;
  }
  /** ADR-210 lift for an exact-pivot upright (edge midpoint / vertex): tallest deck top among the cells touching the pivot. */
  topNear(px: number, py: number, level: number): number {
    const E = 0.25; let m = 0; const xs = new Set([Math.floor(px - E), Math.floor(px + E)]), ys = new Set([Math.floor(py - E), Math.floor(py + E)]);
    for (const y of ys) for (const x of xs) m = Math.max(m, this.topAt(x, y, level)); return m;
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
/**
 * Which side face owns a pixel at top-plane offset (a, b)? ADR-210: a side-face pixel projects onto the top plane
 * diagonally (down-screen = +a and +b), so the face is the side with the LARGER excess past the rim; testing each axis
 * independently (ADR-197) wrongly culled the open front skirt next to a closed neighbour ("teeth"). 0 = inside the top.
 */
export function deckSideOf(a: number, b: number, fw: number, fh: number): number {
  const ea = Math.abs(a) - (fw / 2 + DECK_EDGE_EPS), eb = Math.abs(b) - (fh / 2 + DECK_EDGE_EPS);
  if (ea > 0 && ea >= eb) return a > 0 ? SIDE_PX : SIDE_NX;
  if (eb > 0) return b > 0 ? SIDE_PY : SIDE_NY;
  return 0;
}
/** Is a pixel at tile offset (a, b) kept? (CPU mirror of the fragment shader test.) */
export function deckKeep(a: number, b: number, fw: number, fh: number, mask: number): boolean {
  return (deckSideOf(a, b, fw, fh) & mask) === 0;
}
/** Keep region as a screen polygon around the pivot (Canvas2D clip): closed sides cut a wedge bounded by the diagonals. */
export function deckClipPolygon(fw: number, fh: number, mask: number, top: number, hw: number, hh: number): [number, number][] {
  const L = 64; const ha = fw / 2 + DECK_EDGE_EPS, hb = fh / 2 + DECK_EDGE_EPS;
  const p = (a: number, b: number): [number, number] => [(a - b) * hw, (a + b) * hh - top];
  const c: [number, number][] = [[ha, -hb], [ha, hb], [-ha, hb], [-ha, -hb]];
  const far = (k: number): [number, number] => { const q = c[k]!; return [q[0] + Math.sign(q[0]) * L, q[1] + Math.sign(q[1]) * L]; };
  const sides = [SIDE_PX, SIDE_PY, SIDE_NX, SIDE_NY], out: [number, number][] = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; const u = mask & sides[i]! ? c[i]! : far(i), v = mask & sides[i]! ? c[j]! : far(j); out.push(p(u[0], u[1]), p(v[0], v[1])); }
  return out;
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

/**
 * ADR-210: tie-break for exact-pivot pieces (edge walls at x+0.5 / y+0.5, vertex posts). Twice (x - y) is an integer
 * that differs between the N-edge and W-edge walls meeting at a junction, so their equal keys never z-fight.
 * Max 7 * 0.0004 + ghost 0.004 = 0.0068 < 0.01 layer bias.
 */
export const EXACT_TB_STEP = 0.0004;
export const exactTieBreak = (px: number, py: number, ghost: boolean): number => ((((Math.round(2 * (px - py)) % 8) + 8) % 8) * EXACT_TB_STEP + (ghost ? GHOST_TB : 0));
/** ADR-210: a vertex corner post draws just in front of every wall whose end meets its vertex (pivot key + 0.5). */
export const VERTEX_POST_BIAS = 0.53;
