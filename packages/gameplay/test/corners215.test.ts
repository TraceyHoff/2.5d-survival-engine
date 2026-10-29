/**
 * ADR-215 corner posts: free-standing inner / angled vertex corners block a walker body (post + stubs / the 45 deg run),
 * the same in client prediction replay; bodies already overlapping a post can leave; L corners still use edges.
 */
import { describe, it, expect } from "vitest";
import { type Entity, type World } from "@engine/core";
import { applyMovementInput, bodyAxisMove, cornerPostBoxes, POST_HALF, STUB_HALF, defaultDefs, structures } from "../src/index.js";
import { pos, tp, world215 } from "./nav215_fixture.js";
import { steps } from "./helpers.js";

const d = defaultDefs(); const DT = 1 / 20; const R = d.movement.bodyRadius;
function walk(w: World, e: Entity, dx: number, dy: number, n: number): void {
  const sx = (dx - dy) * Math.SQRT1_2, sy = (dx + dy) * Math.SQRT1_2;
  for (let i = 0; i < n; i++) applyMovementInput(w, e, 0, DT, { x: sx, y: sy });
}
function field(): ReturnType<typeof world215> {
  const f = world215(); for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) f.put("foundation", x + 0.5, y + 0.5); return f;
}
const Z = d.movement.deckStandHeight;
/** Body square (half R) overlaps any [cx, cy, hx, hy] box by more than a hair? */
const overlap = (p: { x: number; y: number }, b: number[]): boolean => { for (let i = 0; i < b.length; i += 4) if (Math.abs(p.x - b[i]!) < R + b[i + 2]! - 1e-3 && Math.abs(p.y - b[i + 1]!) < R + b[i + 3]! - 1e-3) return true; return false; };

describe("ADR-215 corner posts", () => {
  it("wall_corner_inner: the post and both stubs block a body from every side (no overlap along any walk)", () => {
    for (const rot of [0, 1, 2, 3]) {
      const { w, me, put } = field(); const c = put("wall_corner_inner", 3, 3, 0, rot); steps(w, 2);
      expect(structures(w).vertexPosts).toBe(1);
      const boxes = cornerPostBoxes(structures(w).def(c)!, rot, 3, 3);
      expect(bodyAxisMove(w, 1.5, 3, 4, 0, 0, false)).toBeLessThanOrEqual(3 - POST_HALF - R + 1e-3);
      expect(bodyAxisMove(w, 3, 1.5, 4, 1, 0, false)).toBeLessThanOrEqual(3 - POST_HALF - R + 1e-3);
      expect(bodyAxisMove(w, 4.5, 3, 2, 0, 0, false)).toBeGreaterThanOrEqual(3 + POST_HALF + R - 1e-3);
      expect(bodyAxisMove(w, 3, 4.5, 2, 1, 0, false)).toBeGreaterThanOrEqual(3 + POST_HALF + R - 1e-3);
      for (const [sx, sy, dx, dy] of [[1.5, 3, 1, 0], [4.5, 3, -1, 0], [3, 1.5, 0, 1], [3, 4.5, 0, -1], [1.6, 1.7, 1, 1], [4.4, 4.3, -1, -1], [4.4, 1.6, -1, 1], [1.6, 4.4, 1, -1], [3.2, 1.5, 0, 1], [1.5, 3.18, 1, 0]] as const) {
        tp(w, me, sx, sy, Z); for (let i = 0; i < 50; i++) { walk(w, me, dx, dy, 1); expect(overlap(pos(w, me), boxes), `rot ${rot} from ${sx},${sy} tick ${i}`).toBe(false); }
      }
      // a stub sticks out 0.22 along its arm: walking at it end-on stops on the stub, not the post
      const ax = [1, -1, -1, 1][rot]!;
      expect(bodyAxisMove(w, 3 + ax * 1.5, 3, 3, 0, 0, false) * ax).toBeGreaterThanOrEqual((3 + ax * (2 * STUB_HALF + R - 1e-3)) * ax);
    }
    // passing well beside the post is free
    const { w, me, put } = field(); put("wall_corner_inner", 3, 3, 0, 0); steps(w, 2);
    tp(w, me, 1.5, 3.8, Z); walk(w, me, 1, 0, 60); expect(pos(w, me).x).toBeGreaterThan(4.5);
  });
  it("wall_corner_angled blocks along its 45 deg run per art row (8 steps: row = round(rot / 2) % 4)", () => {
    for (const rot of [0, 2, 4, 6, 1, 3]) {
      const { w, me, put } = field(); const c = put("wall_corner_angled", 3, 3, 0, rot); steps(w, 2);
      const boxes = cornerPostBoxes(structures(w).def(c)!, rot, 3, 3);
      for (const [sx, sy, dx, dy] of [[3.35, 1.5, 0, 1], [3.35, 4.5, 0, -1], [2.65, 1.5, 0, 1], [2.65, 4.5, 0, -1], [1.5, 3.35, 1, 0], [4.5, 3.35, -1, 0], [1.5, 2.65, 1, 0], [4.5, 2.65, -1, 0], [1.5, 1.5, 1, 1], [4.5, 4.5, -1, -1], [4.5, 1.5, -1, 1], [1.5, 4.5, 1, -1]] as const) {
        tp(w, me, sx, sy, Z); for (let i = 0; i < 50; i++) { walk(w, me, dx, dy, 1); expect(overlap(pos(w, me), boxes), `rot ${rot} from ${sx},${sy} tick ${i}`).toBe(false); }
      }
    }
    const b0 = cornerPostBoxes(d.pieces.get(d.pieceId("wall_corner_angled"))!, 0, 0, 0); expect(b0[4]).toBeCloseTo(0.06); expect(b0[5]).toBeCloseTo(-0.06); // row 0: toward +x/-y
    const b2 = cornerPostBoxes(d.pieces.get(d.pieceId("wall_corner_angled"))!, 2, 0, 0); expect(b2[4]).toBeCloseTo(0.06); expect(b2[5]).toBeCloseTo(0.06); // row 1: (x, y) -> (-y, x)
    // the run blocks a body crossing it: from the -x/-y side toward +x/+y along the run's normal, rot 0
    const { w, me, put } = field(); put("wall_corner_angled", 3, 3, 0, 0); steps(w, 2);
    tp(w, me, 2.0, 1.5, Z); walk(w, me, 1, 1, 40); const p = pos(w, me); expect(p.x + p.y).toBeLessThan(6.0); // stopped on the diagonal (x + y = 6 line; x - y = 0.5 crosses its middle)
  });
  it("a body overlapping a post is never trapped; zombies collide with posts too", () => {
    const { w, me, put } = field(); put("wall_corner_inner", 3, 3, 0, 0); steps(w, 2);
    tp(w, me, 3.1, 3.1, Z); walk(w, me, -1, -1, 20); const p = pos(w, me); expect(p.x).toBeLessThan(2.6); expect(p.y).toBeLessThan(2.6);
    expect(bodyAxisMove(w, 1.5, 3, 4, 0, 0, false)).toBeLessThan(3 - POST_HALF - R + 1e-3);
  });
  it("prediction replay is deterministic past posts", () => {
    const run = (): { x: number; y: number }[] => {
      const { w, me, put } = field(); put("wall_corner_inner", 3, 3, 0, 1); put("wall_corner_angled", 2, 2, 0, 3); steps(w, 2);
      tp(w, me, 0.6, 0.6, Z); const tr: { x: number; y: number }[] = [];
      for (let i = 0; i < 120; i++) { const a = i * 0.11; walk(w, me, Math.cos(a), Math.sin(a) * 0.7 + 0.5, 1); tr.push(pos(w, me)); }
      return tr;
    };
    expect(run()).toEqual(run());
  });
});
