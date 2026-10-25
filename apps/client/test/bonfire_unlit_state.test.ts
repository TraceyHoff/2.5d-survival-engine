// ADR-141: a placed campfire (bonfire art) that is out drew full flames: syncPieceState asked for the "unlit" building
// state, but the bonfire sprite declared none, so the default (burning) frames were used.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../../../packages/assets/pack/manifest.json", import.meta.url), "utf8")) as { sprites: { key: string; animations?: Record<string, { frames: number[] }>; building?: { frames: number[][]; states?: Record<string, number[][]> } }[] };

describe("bonfire unlit building state", () => {
  it("declares an unlit state whose intact frame is the unlit art, not the burning one", () => {
    const b = manifest.sprites.find((s) => s.key === "bonfire")!;
    const unlit = b.building?.states?.unlit; expect(unlit).toBeDefined();
    expect(unlit![0]![0]).toBe(b.animations!.unlit!.frames[0]);
    expect(unlit![0]![0]).not.toBe(b.building!.frames[0]![0]);
  });
});
