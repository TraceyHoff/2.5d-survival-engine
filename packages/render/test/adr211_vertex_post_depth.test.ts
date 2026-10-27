// ADR-211: a vertex corner post must out-rank the walls meeting at its vertex in the WebGL2 per-pixel depth too
import { describe, expect, test } from "vitest";
import { DEFAULT_ISO } from "@engine/world";
import { isoZDepthFactor } from "../src/depth.js";
import { exactTieBreak, vertexPostGlBias, VERTEX_POST_BIAS } from "../src/building/deckFaces.js";

describe("ADR-211 vertex post depth (WebGL2)", () => {
  const hh = DEFAULT_ISO.tileH / 2, zpp = isoZDepthFactor(DEFAULT_ISO) / DEFAULT_ISO.zStep;
  // shader: key = pivotKey + 0.02 + hp * zPerPx, hp = pixel height above the sprite pivot (screen px)
  const pixKey = (px: number, py: number, bias: number, screenY: number): number => {
    const pivotY = (px + py) * hh; return px + py + bias + Math.max(0, pivotY - screenY) * zpp;
  };
  test("post beats every wall whose end meets its vertex at every shared pixel", () => {
    const vx = 5, vy = 7; const post = vertexPostGlBias(hh, zpp) + exactTieBreak(vx, vy, false);
    const walls: [number, number][] = [[vx + 0.5, vy + 0.02], [vx + 0.02, vy + 0.5], [vx - 0.5, vy - 0.02], [vx - 0.02, vy - 0.5], [vx + 0.5, vy - 0.02], [vx - 0.02, vy + 0.5]];
    for (const [wx, wy] of walls) for (let up = 0; up <= 96; up += 4) {
      const y = (vx + vy) * hh - up;
      expect(pixKey(vx, vy, post, y)).toBeGreaterThan(pixKey(wx, wy, exactTieBreak(wx, wy, false), y));
    }
  });
  test("the old whole-sprite bias alone lost to the near walls (the bug)", () => {
    const vx = 5, vy = 7, y = (vx + vy) * hh - 40;
    expect(pixKey(vx, vy, VERTEX_POST_BIAS, y)).toBeLessThan(pixKey(vx + 0.5, vy + 0.02, 0, y));
  });
  test("an occupant / wall one tile in front still draws over the post", () => {
    const vx = 5, vy = 7, y = (vx + vy) * hh - 30;
    expect(pixKey(vx + 0.5, vy + 1.02, exactTieBreak(vx + 0.5, vy + 1.02, false), y)).toBeGreaterThan(pixKey(vx, vy, vertexPostGlBias(hh, zpp) + exactTieBreak(vx, vy, false), y));
    expect(pixKey(vx + 0.5, vy + 0.5, 0, y)).toBeGreaterThan(pixKey(vx, vy, vertexPostGlBias(hh, zpp), y));
    expect(vertexPostGlBias(hh, zpp)).toBeLessThan(1.2);
  });
});
