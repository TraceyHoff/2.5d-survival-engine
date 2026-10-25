import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { STUMP_SPECIES, stumpKeys, stumpSpecies } from "../src/stumps.js";
import { CREATURE_HPBAR, nineSlice } from "../src/gather-fx.js";

const nat = JSON.parse(readFileSync(new URL("../../../packages/assets/pack/nature/manifest.nature.json", import.meta.url), "utf8")) as { sprites: { key: string; atlas: string }[]; atlases: { key: string; frameW: number; frameH: number; nineSlice?: Record<string, { l: number; t: number; r: number; b: number }> }[] };

describe("ADR-134 species stumps", () => {
  it("derives species from node kind keys", () => {
    for (const s of STUMP_SPECIES) { expect(stumpSpecies(`${s}_tree`)).toBe(s); expect(stumpKeys(`${s}_tree`)).toEqual([`${s}_tree_stump`, "tree_stump"]); }
    expect(stumpSpecies("tree_pine")).toBe("pine");
    expect(stumpKeys("tree")).toEqual(["tree_stump", "tree_stump"]);
    expect(stumpKeys("resin_tree")).toEqual(["tree_stump", "tree_stump"]);
    expect(stumpKeys(undefined)).toEqual(["tree_stump", "tree_stump"]);
  });
  it("every species stump exists in the nature manifest", () => {
    const keys = new Set(nat.sprites.map((s) => s.key));
    for (const s of STUMP_SPECIES) expect(keys.has(`${s}_tree_stump`)).toBe(true);
  });
});

describe("ADR-134 creature hp-bar 9-slice", () => {
  it("matches the manifest frame and slice", () => {
    const sp = nat.sprites.find((s) => s.key === "ui_creature_hpbar_frame")!; const at = nat.atlases.find((a) => a.key === sp.atlas)!;
    expect([at.frameW, at.frameH]).toEqual([CREATURE_HPBAR.cellW, CREATURE_HPBAR.cellH]);
    expect(at.nineSlice?.["0"]).toEqual(CREATURE_HPBAR.slice);
    expect(nat.sprites.some((s) => s.key === "ui_node_hpbar_frame")).toBe(true);
  });
  it("tiles the dest rect exactly and samples only the 24x6 bar", () => {
    const p = nineSlice(10, 20, 60, 8, 2, 1.5); expect(p).toHaveLength(9);
    expect(p.reduce((a, q) => a + q[6] * q[7], 0)).toBeCloseTo(60 * 8);
    for (const [sx, sy, sw, sh] of p) { expect(sx).toBeGreaterThanOrEqual(8); expect(sx + sw).toBeLessThanOrEqual(56); expect(sy).toBeGreaterThanOrEqual(10); expect(sy + sh).toBeLessThanOrEqual(22); }
    expect(p[0]!.slice(4, 8)).toEqual([10, 20, 4.5, 1.5]);
  });
  it("collapses gracefully when tiny", () => { for (const q of nineSlice(0, 0, 2, 1)) { expect(q[6]).toBeGreaterThan(0); expect(q[7]).toBeGreaterThan(0); } });
});
