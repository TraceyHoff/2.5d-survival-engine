import { describe, expect, it } from "vitest";
import { IsoCamera } from "../src/camera.js";
import { previewPlacement } from "../src/character/preview.js";

// device-px pivot the sprite shader puts iso point (0,0) at, after IsoCamera.viewUniform snapping
const pivotPx = (W: number, H: number, cx: number, cy: number, k: number): [number, number] => {
  const c = new IsoCamera(); c.setViewport(W, H, 1); c.zoom = k; c.x = cx; c.y = cy;
  const u = c.viewUniform(new Float32Array(4)); return [(0 - u[0]!) * k + W / 2, (0 - u[1]!) * k + H / 2];
};

describe("character preview placement (matches CharacterPreview2D)", () => {
  for (const [css, dpr] of [[[168, 216], 1], [[168, 216], 2], [[168, 216], 2.625], [[167, 215], 1.5], [[360, 480], 3]] as const) {
    it(`css ${css[0]}x${css[1]} @ dpr ${dpr}`, () => {
      const W = Math.round(css[0] * dpr), H = Math.round(css[1] * dpr);
      const p = previewPlacement(W, H);
      const s2d = (H * 0.62) / 64; expect(p.scale).toBe(s2d >= 1 ? Math.floor(s2d) : s2d);
      expect(Number.isInteger(p.scale)).toBe(true);
      expect([p.pivotX, p.pivotY]).toEqual([Math.round(W / 2), Math.round(H * 0.81)]);
      const [x, y] = pivotPx(W, H, p.camDx, p.camDy, p.scale);
      expect(x).toBeCloseTo(p.pivotX, 3); expect(y).toBeCloseTo(p.pivotY, 3);
    });
  }
  it("user zoom stays an integer scale", () => { expect(previewPlacement(441, 567, 1.7).scale).toBe(Math.floor(567 * 0.62 / 64 * 1.7)); });
});
