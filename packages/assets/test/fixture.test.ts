import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, AssetRegistry, validateBuildingSprites } from "../src/index.js";
import { FIXTURE_DIR } from "../src/node.js";

/** Placeholder-specific assertions: they describe the generated fixture in sample/, not the real pack. */
const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
const lockFile = JSON.parse(readFileSync(FIXTURE_DIR + "ids.lock.json", "utf8"));

describe("placeholder fixture (sample/)", () => {
  const { registry } = loadManifest(sample, { lock: lockFile });
  it("animation frame resolution with 8 iso facings", () => {
    const { registry } = loadManifest(sample); const id = registry.id("player");
    expect(AssetRegistry.directionIndex(0, 8)).toBe(0); expect(AssetRegistry.directionIndex(Math.PI / 2, 8)).toBe(2); expect(AssetRegistry.directionIndex(-Math.PI / 2, 4)).toBe(3);
    const f = registry.frame(id, "walk", Math.PI / 2, 0.13); // frame index 1 of [2,3] -> 3, dir 2 -> +8
    expect(f.frame).toBe(3 + 2 * 4); expect([f.x, f.y, f.w, f.h]).toEqual([96, 96, 32, 48]); expect(f.anchorY).toBeCloseTo(48 * 0.92);
  });
  it("building frames by rotation and damage stage", () => {
    const id = registry.id("wall");
    expect([0, 1, 2, 3].map((st) => registry.buildingFrame(id, 2, st).frame)).toEqual([1, 5, 9, 13]);
    expect(registry.buildingFrame(id, 0, 9).frame).toBe(13);
  });
  it("variant sets with tints and palette swaps", () => {
    expect(registry.variantsOf("player_variants").map((v) => v.key)).toEqual(["player_red", "player_blue", "player_tan"]);
    expect(registry.variant("player_red").tint).toBe(0xff6b6b);
    const z = registry.variant("zombie_pale"); expect(z.sprite).toBe(registry.id("zombie_walker"));
    expect(registry.palettes.get(z.palette!)!.map.get(0x78aa5a)).toBe(0x9aa0a8);
  });
  it("cross-checks building sprites against BuildPieceDefs", () => {
    const pieces: Record<string, { footprint: { w: number; h: number }; layer: number }> = {
      floor: { footprint: { w: 2, h: 2 }, layer: 0 }, wall: { footprint: { w: 2, h: 1 }, layer: 1 }, pillar: { footprint: { w: 1, h: 1 }, layer: 1 } }; // INTEGRATION.md table: pillar is layer 1
    const lookup = { byKey: (k: string) => { const p = pieces[k]; if (!p) throw new Error("x"); return p; } };
    const issues = validateBuildingSprites(registry, lookup);
    expect(issues).toEqual(["campfire: unknown build piece \"campfire\""]);
    pieces.pillar!.layer = 2; pieces.wall!.footprint = { w: 1, h: 1 }; const bad = validateBuildingSprites(registry, lookup);
    expect(bad.length).toBe(3); expect(bad).toContain("pillar: layer 1 != piece layer 2"); expect(bad).toContain("wall: footprint 2x1 != piece 1x1");
  });
});
