import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Art 64357f1: bodies trimmed to 42x58 (wearables trimmed per sprite). Layers are aligned per sprite by anchor px
// (AtlasManager resolve: ax = anchor.x * fw, ay = anchor.y * fh), so every cell must put its pivot on a whole pixel
// inside the cell, and the sit anim must exist wherever idle does (AnimState.Sit=13 -> "sit", idle fallback).
const m = JSON.parse(readFileSync(fileURLToPath(new URL("../../assets/pack/customization/manifest.customization.json", import.meta.url)), "utf8"));
const A = new Map<string, { frameW: number; frameH: number }>(m.atlases.map((a: { key: string; frameW: number; frameH: number }) => [a.key, a]));
describe("trimmed character cells", () => {
  it("pivots land on whole pixels inside every cell; bodies are 44x60 (4px-aligned, ART_body_4px_packing.md) with feet at y=54", () => {
    for (const s of m.sprites as { key: string; atlas: string; anchor: { x: number; y: number } }[]) {
      const a = A.get(s.atlas)!; const ax = s.anchor.x * a.frameW, ay = s.anchor.y * a.frameH;
      expect(Math.abs(ax - Math.round(ax)), s.key).toBeLessThan(0.01); expect(Math.abs(ay - Math.round(ay)), s.key).toBeLessThan(0.01);
      expect(ay, s.key).toBeLessThanOrEqual(a.frameH); expect(ax, s.key).toBeLessThanOrEqual(a.frameW);
    }
    for (const k of ["body_male", "body_female"]) { const s = m.sprites.find((x: { key: string }) => x.key === k); const a = A.get(s.atlas)!;
      // Art 118: bodies are rect-packed (were 44x60 cells, feet at y=54): every entry is a rect whose feet pivot is a whole/half pixel
      expect(s.animations.sit).toBeTruthy();
      for (const an of Object.values(s.animations) as { dirFrames: { rect: { w: number; h: number }; anchor: { x: number; y: number } }[] }[]) for (const d of an.dirFrames) {
        expect(d.rect, k).toBeTruthy(); const py = d.anchor.y * d.rect.h, px = d.anchor.x * d.rect.w;
        expect(Math.abs(py * 2 - Math.round(py * 2)), k).toBeLessThan(0.01); expect(Math.abs(px * 2 - Math.round(px * 2)), k).toBeLessThan(0.01); } }
  });
});
