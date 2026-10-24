import { describe, expect, it } from "vitest";
import { DEFAULT_BANDS } from "@engine/world";
import { TILE_COLORS } from "../src/canvas2d.js";

const hue = (c: string) => ({ r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) });
describe("Canvas2D ground colours follow the world tile ids", () => {
  it("water is blue, grass and forest green, sand light", () => {
    const [water, sand, grass, forest] = DEFAULT_BANDS.map((b) => hue(TILE_COLORS[b.tile]!));
    expect(water!.b).toBeGreaterThan(water!.g); expect(water!.b).toBeGreaterThan(water!.r);
    for (const c of [grass!, forest!]) { expect(c.g).toBeGreaterThan(c.r); expect(c.g).toBeGreaterThan(c.b); }
    expect(sand!.r + sand!.g).toBeGreaterThan(300);
  });
});
