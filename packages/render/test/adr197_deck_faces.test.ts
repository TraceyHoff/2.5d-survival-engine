import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DeckNeighbors, deckTopPx, deckTileOffset, deckKeep, deckClipPolygon, pieceTieBreak, pieceOrder, SIDE_PX, SIDE_PY, SIDE_NX, SIDE_NY } from "../src/building/deckFaces.js";

const HW = 32, HH = 16;
const TIERS = ["foundation_twig", "foundation", "foundation_stone", "foundation_metal"];
const FLOORS = ["floor", "floor_twig", "floor_stone", "floor_metal"].filter((k) => deckTopPx(k) !== undefined);
interface P { ax: number; ay: number; level: number; key: string; top: number; layer: number; ghost: boolean }
/** 10x10 mixed-tier foundation base, a 10x10 floor deck on level 1, walls (uprights) on both levels, one ghost. */
function base(): P[] {
  const out: P[] = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const f = TIERS[(x * 7 + y * 3) % TIERS.length]!; out.push({ ax: x, ay: y, level: 0, key: f, top: deckTopPx(f)!, layer: 0, ghost: false });
    const fl = FLOORS[(x + y) % FLOORS.length]!; out.push({ ax: x, ay: y, level: 1, key: fl, top: deckTopPx(fl)!, layer: 0, ghost: false });
  }
  for (let i = 0; i < 10; i++) for (const level of [0, 1]) out.push({ ax: i, ay: 0, level, key: "wall", top: 0, layer: 1, ghost: false });
  out.push({ ax: 4, ay: 4, level: 1, key: FLOORS[0]!, top: deckTopPx(FLOORS[0])!, layer: 0, ghost: true });
  return out;
}
const masks = (ps: P[], cull: boolean): number[] => {
  const n = new DeckNeighbors(); for (const p of ps) if (p.layer === 0 && !p.ghost) n.add(p.ax, p.ay, 1, 1, p.level, p.top);
  return ps.map((p) => (cull && p.layer === 0 ? n.mask(p.ax, p.ay, 1, 1, p.level, p.top) : 0));
};

describe("ADR-197 deck side-face culling", () => {
  it("art-derived tops: every foundation tier shares one top height, floors are lower", () => {
    for (const k of TIERS) expect(deckTopPx(k)).toBe(12);
    expect(FLOORS.length).toBeGreaterThan(0); for (const k of FLOORS) expect(deckTopPx(k)).toBe(5);
  });
  it("10x10 mixed-tier base on 2 levels: interior sides all closed, only outward sides open", () => {
    const ps = base(), m = masks(ps, true);
    ps.forEach((p, i) => {
      if (p.layer !== 0) return;
      const want = (p.ax < 9 ? SIDE_PX : 0) | (p.ay < 9 ? SIDE_PY : 0) | (p.ax > 0 ? SIDE_NX : 0) | (p.ay > 0 ? SIDE_NY : 0);
      expect(m[i]).toBe(want);
    });
  });
  it("a lower neighbour does not hide a taller deck's side; demolish reopens it", () => {
    const n = new DeckNeighbors(); n.add(0, 0, 1, 1, 0, 12); n.add(1, 0, 1, 1, 0, 5);
    expect(n.mask(0, 0, 1, 1, 0, 12) & SIDE_PX).toBe(0); expect(n.mask(1, 0, 1, 1, 0, 5) & SIDE_NX).toBe(SIDE_NX);
    n.clear(); n.add(0, 0, 1, 1, 0, 12); expect(n.mask(0, 0, 1, 1, 0, 12)).toBe(0);
    n.add(1, 0, 1, 1, 1, 12); expect(n.mask(0, 0, 1, 1, 0, 12)).toBe(0); // other level does not count
  });
  it("Canvas2D clip polygon equals the per-pixel keep test", () => {
    for (const mask of [0, 1, 3, 5, 15, 10]) {
      const poly = deckClipPolygon(1, 1, mask, 12, HW, HH);
      const inside = (x: number, y: number): boolean => { let s = 0; for (let i = 0; i < 4; i++) { const [x0, y0] = poly[i]!, [x1, y1] = poly[(i + 1) % 4]!; const c = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0); if (Math.abs(c) < 1e-9) continue; s |= c > 0 ? 1 : 2; } return s !== 3; };
      for (let y = -60; y < 40; y += 1.37) for (let x = -50; x < 50; x += 1.37) { const [a, b] = deckTileOffset(x, y, 12, HW, HH); expect(inside(x, y)).toBe(deckKeep(a, b, 1, 1, mask)); }
    }
  });
});

/**
 * Software raster of the base: each deck is the shape of the art (top diamond `top` px up, skirt down to the ground),
 * drawn with LESS depth like the GPU. Within equal keys the GPU's raster order is not fixed (batching, chunk rebuilds),
 * so the order is shuffled per frame, and the camera jitters sub-pixel. Output must not change; no interior skirt shows.
 */
function raster(ps: P[], cull: boolean, tie: boolean, frame: number): { img: Int32Array; skirt: number; tied: number; drawn: number } {
  const W = 760, H = 480, img = new Int32Array(W * H).fill(-1), dep = new Float64Array(W * H).fill(-Infinity);
  const m = masks(ps, cull); let seed = (Math.imul(frame + 1, 2654435761) >>> 0) || 1; const rnd = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const order = ps.map((_, i) => i).sort(() => rnd() - 0.5);
  const jx = Math.sin(frame * 1.7) * 0.45, jy = Math.cos(frame * 2.3) * 0.45; const ox = Math.round(380 + jx), oy = Math.round(60 + jy);
  const skirtOwner = new Int8Array(W * H); let tied = 0, drawn = 0;
  for (const i of order) {
    const p = ps[i]!; if (p.layer !== 0) continue;
    const pvx = (p.ax + 0.5 - (p.ay + 0.5)) * HW + ox, pvy = (p.ax + 0.5 + p.ay + 0.5) * HH + oy - p.level * 40;
    const key = p.level * 1e3 + (p.ax + p.ay) + (tie ? pieceTieBreak(p.ax, p.ay, p.ghost) : 0);
    for (let y = -40; y < 30; y++) for (let x = -34; x < 34; x++) {
      const [a, b] = deckTileOffset(x + 0.5, y + 0.5, p.top, HW, HH); const [ga, gb] = deckTileOffset(x + 0.5, y + 0.5, 0, HW, HH);
      const R = 0.06, E = 0.5 + 0.02; // art rim ~2px past the top edge; E = keep tolerance edge
      const onTop = Math.abs(a) <= 0.5 && Math.abs(b) <= 0.5; const inRim = Math.abs(a) <= 0.5 + R && Math.abs(b) <= 0.5 + R;
      const onSkirt = !inRim && ga <= 0.5 + R && gb <= 0.5 + R && a > -0.5 - R && b > -0.5 - R;
      if (!inRim && !onSkirt) continue; if (!deckKeep(a, b, 1, 1, m[i]!)) continue;
      const X = Math.floor(pvx + x), Y = Math.floor(pvy + y); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const k = Y * W + X;
      const interior = (p.ax < 9 && a > E) || (p.ay < 9 && b > E) || (p.ax > 0 && a < -E) || (p.ay > 0 && b < -E);
      if (interior && !p.ghost) drawn++;
      if (key === dep[k]! && img[k]! >> 1 !== i) tied++;
      if (key > dep[k]! || (key === dep[k]! && (rnd() < 0.5))) { dep[k] = key; img[k] = i * 2 + (onTop ? 0 : 1); skirtOwner[k] = interior && !p.ghost ? 1 : 0; }
    }
  }
  let skirt = 0; for (let k = 0; k < W * H; k++) skirt += skirtOwner[k]!;
  return { img, skirt, tied, drawn };
}

describe("ADR-197 stable output over 120 jittered frames", () => {
  const ps = base();
  it("with culling + tie-break: zero interior side pixels and identical frames", () => {
    const f0 = raster(ps, true, true, 0); expect(f0.skirt).toBe(0); expect(f0.tied).toBe(0); expect(f0.drawn).toBe(0);
    for (let f = 1; f < 120; f++) { const r = raster(ps, true, true, f); expect(r.skirt).toBe(0); expect(Buffer.from(r.img.buffer).equals(Buffer.from(f0.img.buffer))).toBe(true); }
  });
  it("without the fix interior side fragments reach the depth test and equal keys tie (regression guard)", () => {
    // Before ADR-197 hidden sides relied on depth alone (a coarse 24-bit key flips them in and out under jitter),
    // and the ghost had the same key as the piece under it, so the raster order decided the pixel.
    const f0 = raster(ps, false, false, 0); expect(f0.drawn).toBeGreaterThan(1000); expect(f0.tied).toBeGreaterThan(0);
    let diff = 0; for (let f = 1; f < 120; f++) if (!Buffer.from(raster(ps, false, false, f).img.buffer).equals(Buffer.from(f0.img.buffer))) diff++;
    expect(diff).toBeGreaterThan(0);
  });
  it("pieceOrder is unique per (level, layer, cell) and the tie-break stays under the layer bias", () => {
    const s = new Set(base().map((p) => pieceOrder(p.level, p.layer, p.ax, p.ay) * 2 + (p.ghost ? 1 : 0))); expect(s.size).toBe(base().length);
    expect(pieceTieBreak(3, 0, true)).toBeLessThan(0.01);
  });
});

describe("ADR-197 renderers are wired", () => {
  const gl = readFileSync(join(__dirname, "../src/sprites.ts"), "utf8"), c2 = readFileSync(join(__dirname, "../src/canvas2d.ts"), "utf8");
  it("WebGL2 writes the mask and discards in the fragment shader; static sort is total", () => {
    expect(gl).toMatch(/o\[38\] =/); expect(gl).toMatch(/vDeckM/); expect(gl).toMatch(/discard/); expect(gl).toMatch(/pieceTieBreak\(/);
  });
  it("Canvas2D clips decks, sorts by a total order and snaps the camera origin", () => {
    expect(c2).toMatch(/deckClipPolygon\(/); expect(c2).toMatch(/\(a\.depth - b\.depth\) \|\| \(a\.ord - b\.ord\)/); expect(c2).toMatch(/Math\.round\(this\.w \/ 2 - cam\.x \* s\)/);
  });
});
