import { describe, expect, test } from "vitest";
import { NAME_TAG, TAG_GAP, declutterTags, type NameTagPoint } from "../src/name-tags.js";

const pt = (e: number, x: number, y: number, name = `P${e}`): NameTagPoint => ({ e: e as never, x, y, dist: 1, name, kind: "other", alpha: 1 });
const W = () => 40; const bh = NAME_TAG.font + 6;
const boxes = (pts: NameTagPoint[], ys: number[]) => pts.map((p, i) => ({ x: p.x, y: ys[i]! }));
const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 52 && Math.abs(a.y - b.y) < bh;

describe("ADR-189: name tags declutter vertically", () => {
  test("overlapping tags are nudged apart; the lowest (nearest the camera) keeps its spot", () => {
    const pts = [pt(1, 100, 200), pt(2, 108, 196), pt(3, 95, 203)];
    const ys = declutterTags(pts, W); const b = boxes(pts, ys);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(overlap(b[i]!, b[j]!)).toBe(false);
    expect(ys[2]).toBe(203); expect(ys[0]).toBe(203 - bh - TAG_GAP);
    for (let i = 0; i < pts.length; i++) expect(ys[i]!).toBeLessThanOrEqual(pts[i]!.y); // only ever up
  });
  test("tags apart stay put; layout is stable (same input -> same output, input order irrelevant)", () => {
    const far = [pt(1, 100, 200), pt(2, 300, 200)]; expect(declutterTags(far, W)).toEqual([200, 200]);
    const a = [pt(1, 100, 200), pt(2, 104, 199)]; const r1 = declutterTags(a, W), r2 = declutterTags([a[1]!, a[0]!], W);
    expect(r1).toEqual(declutterTags(a, W)); expect([r2[1], r2[0]]).toEqual(r1);
  });
});
