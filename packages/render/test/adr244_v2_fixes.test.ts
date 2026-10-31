/** ADR-244 Art v2 fixes: exact aliases, per-sheet stream pools, sleep_lie bed fits. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { V2S_ALIAS, isV2StreamSheet, bedFit, bedFitTable, BED_FITS, BED_SORT_EPS, animChainFor } from "../src/index.js";

const PACK = fileURLToPath(new URL("../../assets/pack/customization_v2_sample/", import.meta.url));
const manifest = JSON.parse(readFileSync(PACK + "manifest.customization_v2_sample.json", "utf8")) as { atlases: { key: string; residency?: string }[]; sprites: { key: string }[] };
const sample = JSON.parse(readFileSync(PACK + "sample.v2.json", "utf8")) as { sleepLie: { bedFits: unknown } };

describe("ADR-244 (a) exact v2 aliases", () => {
  it("every V2S_ALIAS target is a sprite the sample manifest ships (no scrap compat names)", () => {
    const keys = new Set(manifest.sprites.map((s) => s.key));
    for (const v of Object.values(V2S_ALIAS)) { expect(keys.has(v), v).toBe(true); expect(v).not.toMatch(/scrap/); }
  });
});

describe("ADR-244 (b) per-sheet stream pools", () => {
  it("combat / ranged / pose / sleep sheets stream; the core sheets stay resident", () => {
    for (const a of manifest.atlases) expect(isV2StreamSheet(a.key), a.key).toBe(a.residency === "stream");
    expect(isV2StreamSheet("v2s_wr_body_male")).toBe(false); expect(isV2StreamSheet("body_male__combat")).toBe(false);
  });
});

describe("ADR-244 (c) sleep_lie bed fits", () => {
  it("the render copy matches Art's sample.v2.json sleepLie.bedFits", () => { expect(BED_FITS).toEqual(sample.sleepLie.bedFits); });
  it("resolves exact, wildcard (bed_double_*), spot and rotation; unknown = 0,0", () => {
    expect(bedFit("bed", "single", 2)).toEqual({ x: 0, y: 0 });
    expect(bedFitTable("bed_double_luxury")).toBe(BED_FITS["bed_double_*"]);
    const l1 = (BED_FITS["bed_double_*"] as Record<string, { x: number; y: number }[]>).left![1]!;
    expect(bedFit("bed_double_rustic", "left", 1)).toEqual(l1); expect(bedFit("bed_double_rustic", "left", 5)).toEqual(l1);
    expect(bedFit("bunk_bed", "upper", 0).y).toBeLessThan(bedFit("bunk_bed", "lower", 0).y); // upper bunk sits higher on screen
    expect(bedFit("table", "single", 0)).toEqual({ x: 0, y: 0 });
    expect(BED_SORT_EPS).toBeGreaterThan(0); expect(BED_SORT_EPS).toBeLessThan(0.1);
  });
  it("Sleep picks sleep_lie / sleep_lie_under from the replicated bed lie", () => {
    const ctx = (bed?: "lie" | "under") => ({ moving: false, driver: false, elapsed: 0, itemKey: "", weaponClass: undefined, bed });
    const SLEEP = 24;
    expect(animChainFor(SLEEP, ctx("lie") as never)?.[0]).toBe("sleep_lie");
    expect(animChainFor(SLEEP, ctx("under") as never)?.[0]).toBe("sleep_lie_under");
  });
});
