import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, buildPieceVisual, mergeManifests, ManifestMergeError, type ManifestJson } from "../src/index.js";
import { FIXTURE_DIR } from "../src/node.js";

const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8")) as ManifestJson;
const withClans = (): ManifestJson => ({ ...structuredClone(sample), clanPalettes: [{ key: "red", primary: "#ff0000", secondary: "#110000" }, { key: "blue", primary: "#0000ff", secondary: "#000011" }] });

describe("ADR-081 renderer contracts", () => {
  it("clanPaletteForTint: 0 = none, 1..N = clanPalettes[tint-1], out of range = none (no modulo)", () => {
    const { registry: r } = loadManifest(withClans());
    expect(r.clanPaletteForTint(0)).toBeUndefined(); expect(r.clanPaletteForTint(1)?.key).toBe("red"); expect(r.clanPaletteForTint(2)?.key).toBe("blue");
    for (const t of [3, 255, -1, 1.5, NaN]) expect(r.clanPaletteForTint(t)).toBeUndefined();
  });
  it("buildPieceVisual maps type/rot/tint/paint to visualId/frame/layer/palette/ghost", () => {
    const { registry: r } = loadManifest(withClans()); const keys: Record<number, string> = { 1: "wall", 2: "floor" };
    const pieceKey = (t: number) => keys[t];
    const v = buildPieceVisual(r, { type: 1, rot: 2, tint: 1, paint: 0, damageStage: 2, level: 3 }, { pieceKey, ghost: true });
    expect(v.visualId).toBe(r.id("wall")); expect(v.layer).toBe(1); expect(v.level).toBe(3); expect(v.ghost).toBe(1); expect(v.rotation).toBe(2);
    expect(v.frame).toEqual(r.buildingFrame(r.id("wall"), 2, 2)); expect(v.palette?.key).toBe("red"); expect(v.stateIndex).toBe(-1);
    expect(buildPieceVisual(r, { type: 2, rot: 5, tint: 1, paint: 2 }, { pieceKey }).palette?.key).toBe("blue"); // paint overrides tint
    expect(buildPieceVisual(r, { type: 2, rot: 0, tint: 9, paint: 0 }, { pieceKey }).palette).toBeUndefined();
    const none = buildPieceVisual(r, { type: 99, rot: 0, tint: 0, paint: 0 }, { pieceKey, ghost: 2 }); expect(none.visualId).toBe(0); expect(none.frame).toBeUndefined(); expect(none.ghost).toBe(2);
  });
  it("mergeManifests merges every keyed section, reports collisions, resolves atlas paths, strict throws", () => {
    const a = { version: 1, name: "base", atlases: [{ key: "at", image: "a.png", frameW: 1, frameH: 1, columns: 1, rows: 1, masks: { tintmask: "a_t.png" } }], sprites: [],
      clanPalettes: [{ key: "red", primary: "#ff0000", secondary: "#000000" }], wearables: [{ key: "hat1" }], glyphs: { "kbm.key.e": { sprite: "s" } }, skinTones: [{ key: "pale", color: "#ffeedd" }] } as unknown as ManifestJson;
    const b = { version: 1, atlases: [{ key: "at", image: "b.png", frameW: 1, frameH: 1, columns: 1, rows: 1 }, { key: "bt", image: "b.png", frameW: 1, frameH: 1, columns: 1, rows: 1, pages: [{ scale: 2, image: "b2.png" }] }], sprites: [],
      clanPalettes: [{ key: "red", primary: "#ff0000", secondary: "#000000" }, { key: "blue", primary: "#0000ff", secondary: "#000000" }], wearables: [{ key: "hat1" }, { key: "hat2" }],
      palettes: [{ key: "p", source: ["#000000"], target: ["#ffffff"] }], decals: [{ key: "d1" }], glyphs: { "kbm.key.e": { sprite: "t" }, "kbm.key.q": { sprite: "t" } } } as unknown as ManifestJson;
    const { manifest, collisions, warnings } = mergeManifests([{ name: "A", manifest: a }, { name: "B", manifest: b }], { resolve: (p, f) => `/${f}/${p}` });
    const m = manifest as unknown as Record<string, { key: string }[]>;
    expect(m.atlases!.map((x) => x.key)).toEqual(["at", "bt"]); expect((manifest.atlases[0]!).image).toBe("/A/a.png"); expect(manifest.atlases[0]!.masks?.tintmask).toBe("/A/a_t.png"); expect(manifest.atlases[1]!.pages![0]!.image).toBe("/B/b2.png");
    expect(m.clanPalettes!.map((x) => x.key)).toEqual(["red", "blue"]); expect(m.wearables!.map((x) => x.key)).toEqual(["hat1", "hat2"]);
    expect(m.decals!.map((x) => x.key)).toEqual(["d1"]); expect(m.palettes).toHaveLength(1); expect(m.skinTones).toHaveLength(1); expect(Object.keys(manifest.glyphs!)).toEqual(["kbm.key.e", "kbm.key.q"]);
    expect(collisions).toEqual([{ section: "atlases", key: "at", fragments: ["A", "B"] }, { section: "clanPalettes", key: "red", fragments: ["A", "B"] },
      { section: "wearables", key: "hat1", fragments: ["A", "B"] }, { section: "glyphs", key: "kbm.key.e", fragments: ["A", "B"] }]);
    expect(warnings).toHaveLength(4); expect(manifest.name).toBe("base");
    expect(() => mergeManifests([{ name: "A", manifest: a }, { name: "B", manifest: b }], { strict: true })).toThrow(ManifestMergeError);
    expect(mergeManifests([{ name: "S", manifest: sample }]).collisions).toEqual([]);
    expect(() => loadManifest(mergeManifests([{ name: "S", manifest: sample }, { name: "S2", manifest: sample }]).manifest)).not.toThrow();
  });
});
