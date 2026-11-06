import { describe, expect, it } from "vitest";
import { paintTask256Atlases, Task256Frame, TASK256_ATLAS_KEYS } from "../src/task256-art.js";

describe("ADR-257 task256 art", () => {
  it("paints a single 512×256 atlas with distinct non-empty cells for lettuce and hay", () => {
    expect(TASK256_ATLAS_KEYS).toEqual(["crops_task256"]);
    const [atlas] = paintTask256Atlases();
    expect(atlas!.key).toBe("crops_task256");
    expect(atlas!.width).toBe(512);
    expect(atlas!.height).toBe(256);
    const cellHash = (frame: number): string => {
      const col = frame % 8, row = Math.floor(frame / 8);
      const ox = col * 64, oy = row * 64;
      let opaque = 0, r = 0, g = 0, b = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const i = ((oy + y) * 512 + (ox + x)) * 4;
        const a = atlas!.pixels[i + 3]!;
        if (a > 16) { opaque++; r += atlas!.pixels[i]!; g += atlas!.pixels[i + 1]!; b += atlas!.pixels[i + 2]!; }
      }
      expect(opaque).toBeGreaterThan(40);
      return `${opaque}:${Math.round(r / opaque)}:${Math.round(g / opaque)}:${Math.round(b / opaque)}`;
    };
    const lettuce = cellHash(Task256Frame.wildLettuce);
    const cropLettuce = cellHash(Task256Frame.cropLettuce);
    const hay = cellHash(Task256Frame.wildHay);
    const cropHay = cellHash(Task256Frame.cropHay);
    const hayItem = cellHash(Task256Frame.hayItem);
    const haySeeds = cellHash(Task256Frame.haySeeds);
    // Lettuce (green rosette) ≠ hay (straw blades / bale)
    expect(lettuce).not.toBe(hay);
    expect(cropLettuce).not.toBe(cropHay);
    expect(hay).not.toBe(cropHay); // standing clump ≠ tied bale
    expect(hayItem).not.toBe(haySeeds);
    // Green channel dominates lettuce; hay is warmer (higher R relative to G)
    const [, , lg] = lettuce.split(":").map(Number);
    const [, hr, hg] = hay.split(":").map(Number);
    expect(lg!).toBeGreaterThan(100);
    expect(hr! / Math.max(1, hg!)).toBeGreaterThan(0.9);
  });
});
