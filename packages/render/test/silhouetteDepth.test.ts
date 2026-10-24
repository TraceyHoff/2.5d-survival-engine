import { describe, expect, it } from "vitest";
import { LAYER_BIAS, paperDollDepth, silhouetteKey } from "../src/sprites.js";

// key -> depth: larger key = nearer. Silhouette draws with depth GREATER: visible only where stored key > silhouette key.
const visibleOver = (storedKey: number, silKey: number): boolean => storedKey > silKey;

describe("behind-wall silhouette depth", () => {
  const body = paperDollDepth(10, 64, 58, 1, 0.01).key;
  for (const n of [0, 1, 4, 9, 14]) {
    it(`no silhouette over its own ${n} paper-doll layers (no occluder)`, () => {
      const sil = silhouetteKey(body, n);
      expect(visibleOver(body, sil)).toBe(false);
      for (let j = 1; j <= n; j++) expect(visibleOver(body + j * LAYER_BIAS, sil)).toBe(false);
    });
    it(`silhouette still shows behind a wall 0.1..1 tile in front (${n} layers)`, () => {
      const sil = silhouetteKey(body, n);
      for (const d of [0.1, 0.5, 1]) expect(visibleOver(body + d, sil)).toBe(true);
    });
  }
});
