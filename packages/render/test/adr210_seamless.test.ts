/** ADR-210: seamless decks (owning-face culling, connected-texture top seams), edge-wall pivots, corner posts. */
import { describe, it, expect } from "vitest";
import { DeckNeighbors, deckKeep, deckSideOf, deckTileOffset, deckSeamShift, deckSeamPatches, deckClipPolygon, exactTieBreak, VERTEX_POST_BIAS, DECK_SEAM_BAND, DECK_SEAM_SHIFT, deckTopPx, SIDE_PX, SIDE_PY, SIDE_NX, SIDE_NY } from "../src/building/deckFaces.js";
import { pieceRotFlags, ROT_EXACT_PIVOT, ROT_DECK_LIFT, ROT_VERTEX_POST } from "../src/building/modular.js";

const HW = 32, HH = 16, TOP = 12, RIM = 2;
/** Slab silhouette like the tier pack art: top diamond RIM px larger than the tile, skirt TOP px tall. */
function slabOpaque(dx: number, dy: number): boolean {
  const topD = Math.abs(dx) / (HW + RIM) + Math.abs(dy + TOP) / (HH + RIM / 2) <= 1;
  const gD = (y: number) => Math.abs(dx) / (HW + RIM) + Math.abs(dy - y) / (HH + RIM / 2) <= 1; let sk = false;
  for (let s = 0; s <= TOP; s++) if (gD(-s)) { sk = true; break; }
  return topD || sk;
}
function composite(cells: [number, number][]): { img: Set<string>; n: DeckNeighbors } {
  const n = new DeckNeighbors(); for (const [x, y] of cells) n.add(x, y, 1, 1, 0, TOP);
  const img = new Set<string>();
  for (const [x, y] of cells) {
    const m = n.mask(x, y, 1, 1, 0, TOP), cx = (x - y) * HW, cy = (x + y + 1) * HH;
    for (let dy = -50; dy < 30; dy++) for (let dx = -40; dx < 40; dx++) {
      if (!slabOpaque(dx + 0.5, dy + 0.5)) continue; const [a, b] = deckTileOffset(dx + 0.5, dy + 0.5, TOP, HW, HH);
      if (deckKeep(a, b, 1, 1, m)) img.add(`${cx + dx},${cy + dy}`);
    }
  }
  return { img, n };
}

describe("ADR-210 owning-face culling (no skirt 'teeth')", () => {
  it("a 3x3 slab's front faces have no holes: every screen pixel inside the merged silhouette is drawn", () => {
    const cells: [number, number][] = []; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push([x, y]);
    const { img } = composite(cells); let holes = 0;
    // merged silhouette = a 3x3 slab (same art scaled): pivot of the centre cell
    for (let sy = -60; sy < 120; sy++) for (let sx = -120; sx < 120; sx++) {
      const dx = sx + 0.5, dy = sy + 0.5 - 3 * HH; // centre cell (1,1) pivot is (0, 3*HH)
      const topD = Math.abs(dx) / (3 * HW + RIM) + Math.abs(dy + TOP) / (3 * HH + RIM / 2) <= 1 - 0.03;
      let sk = false; for (let s = 1; s < TOP - 1; s++) if (Math.abs(dx) / (3 * HW + RIM) + Math.abs(dy + s) / (3 * HH + RIM / 2) <= 1 - 0.03) { sk = true; break; }
      if ((topD || sk) && !img.has(`${sx},${sy}`)) holes++;
    }
    expect(holes).toBe(0);
  });
  it("a pixel past two rims belongs to the face with the larger excess", () => {
    expect(deckSideOf(0.9, 0.6, 1, 1)).toBe(SIDE_PX); expect(deckSideOf(0.6, 0.9, 1, 1)).toBe(SIDE_PY);
    expect(deckSideOf(-0.8, 0.1, 1, 1)).toBe(SIDE_NX); expect(deckSideOf(0.1, -0.8, 1, 1)).toBe(SIDE_NY); expect(deckSideOf(0.2, 0.3, 1, 1)).toBe(0);
    // the open front skirt under a closed right neighbour's corner stays (pre-ADR-210 it was culled)
    expect(deckKeep(0.55, 0.8, 1, 1, SIDE_PX)).toBe(true); expect(deckKeep(0.8, 0.55, 1, 1, SIDE_PX)).toBe(false);
  });
  it("updates when pieces are added/removed (mask is rebuilt from the neighbour map)", () => {
    const n = new DeckNeighbors(); n.add(0, 0, 1, 1, 0, TOP); expect(n.mask(0, 0, 1, 1, 0, TOP)).toBe(0);
    n.add(1, 0, 1, 1, 0, TOP); expect(n.mask(0, 0, 1, 1, 0, TOP)).toBe(SIDE_PX);
    n.clear(); n.add(0, 0, 1, 1, 0, TOP); expect(n.mask(0, 0, 1, 1, 0, TOP)).toBe(0);
  });
  it("Canvas2D clip polygon matches the per-pixel test for every mask", () => {
    for (let mask = 0; mask < 16; mask++) {
      const poly = deckClipPolygon(1, 1, mask, TOP, HW, HH);
      const inside = (x: number, y: number): boolean => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
      for (let y = -60; y < 40; y += 1.37) for (let x = -50; x < 50; x += 1.37) { const [a, b] = deckTileOffset(x, y, TOP, HW, HH); expect(inside(x, y), `m${mask} ${x},${y}`).toBe(deckKeep(a, b, 1, 1, mask)); }
    }
  });
});

describe("ADR-210 connected-texture top seams", () => {
  it("the border band toward a closed side samples the interior; open sides keep their edge art", () => {
    expect(deckSeamShift(0.45, 0, 1, 1, SIDE_PX)).toEqual([-DECK_SEAM_SHIFT, 0]); expect(deckSeamShift(0.45, 0, 1, 1, 0)).toEqual([0, 0]);
    expect(deckSeamShift(0, -0.45, 1, 1, SIDE_NY)).toEqual([0, DECK_SEAM_SHIFT]); expect(deckSeamShift(0.2, 0.2, 1, 1, 15)).toEqual([0, 0]);
    const src = 0.5 - DECK_SEAM_BAND - DECK_SEAM_SHIFT; expect(src).toBeGreaterThan(-0.5 + DECK_SEAM_BAND); // source is plain interior
  });
  it("Canvas2D patches: one strip per closed side plus closed corners", () => {
    expect(deckSeamPatches(1, 1, 0, TOP, HW, HH)).toHaveLength(0);
    expect(deckSeamPatches(1, 1, SIDE_PX, TOP, HW, HH)).toHaveLength(1);
    expect(deckSeamPatches(1, 1, SIDE_PX | SIDE_PY, TOP, HW, HH)).toHaveLength(3);
    expect(deckSeamPatches(1, 1, 15, TOP, HW, HH)).toHaveLength(8);
    const [p] = deckSeamPatches(1, 1, SIDE_PX, TOP, HW, HH); expect(p!.dx).toBeCloseTo(-DECK_SEAM_SHIFT * HW); expect(p!.dy).toBeCloseTo(-DECK_SEAM_SHIFT * HH);
  });
  it("tier-pack decks are measured slabs (bld_foundation/floor_t1..4)", () => {
    for (let t = 1; t <= 4; t++) { expect(deckTopPx(`bld_foundation_t${t}`)).toBeGreaterThan(0); }
  });
});

describe("ADR-210 edge walls + corners", () => {
  it("edge pieces and openings pivot exactly on the edge and lift to the deck top; corners are vertex posts", () => {
    expect(pieceRotFlags({ placement: 1 })).toBe(ROT_EXACT_PIVOT | ROT_DECK_LIFT);
    expect(pieceRotFlags({ placement: 2, fits: 1 })).toBe(ROT_EXACT_PIVOT | ROT_DECK_LIFT);
    expect(pieceRotFlags({ placement: 2, fits: 4 }) & ROT_EXACT_PIVOT).toBe(0); // floor hatch stays a cell
    expect(pieceRotFlags({ placement: 3, snap: "vertex", key: "wall_corner_outer" })).toBe(ROT_EXACT_PIVOT | ROT_DECK_LIFT | ROT_VERTEX_POST);
    expect(pieceRotFlags({ placement: 3, key: "chair" })).toBe(0); expect(pieceRotFlags({ placement: 0, layer: 1 })).toBe(ROT_DECK_LIFT);
  });
  it("lift = tallest deck touching the pivot (edge midpoint on the perimeter still gets the deck top)", () => {
    const n = new DeckNeighbors(); n.add(0, 0, 1, 1, 0, TOP);
    expect(n.topNear(0.5, 0, 0)).toBe(TOP); expect(n.topNear(0, 0.5, 0)).toBe(TOP); expect(n.topNear(1, 1, 0)).toBe(TOP); expect(n.topNear(3, 3, 0)).toBe(0);
  });
  it("N and W walls meeting at a junction never share a depth key; the corner post draws in front of both", () => {
    const n = exactTieBreak(0.5, 0, false), w = exactTieBreak(0, 0.5, false); expect(n).not.toBe(w);
    const key = (px: number, py: number) => px + py + exactTieBreak(px, py, false);
    expect(key(0, 0) + VERTEX_POST_BIAS).toBeGreaterThan(Math.max(key(0.5, 0), key(0, 0.5), key(-0.5, 0), key(0, -0.5)));
    for (const g of [0, 1]) expect(exactTieBreak(2.5, 1, !!g)).toBeLessThan(0.01);
  });
});
