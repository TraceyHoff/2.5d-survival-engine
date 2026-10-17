import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadManifest, ManifestError, ID_KINDS } from "../src/index.js";

const dir = fileURLToPath(new URL("../sample/", import.meta.url));
const sample = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
const lockFile = JSON.parse(readFileSync(dir + "ids.lock.json", "utf8"));
const issuesOf = (json: unknown): string => { try { loadManifest(json); return ""; } catch (e) { return (e as ManifestError).issues.join("\n"); } };
const mutate = (fn: (m: typeof sample) => void) => { const m = structuredClone(sample); fn(m); return m; };

describe("extended manifest: sounds, vfx, UI, emissive, variants, buildings", () => {
  const { registry } = loadManifest(sample, { lock: lockFile });
  it("committed lock is complete and stable", () => {
    const { lock } = loadManifest(sample, { lock: lockFile }); expect(lock).toEqual(lockFile);
    for (const k of ID_KINDS) expect(Object.keys(lockFile[k]).length).toBeGreaterThan(0);
  });
  it("sounds with variants, defaults, categories", () => {
    const s = registry.sound("sfx_chop"); expect(s.files.length).toBe(3); expect(s).toMatchObject({ volume: 0.8, pitchJitter: 0.1, loop: false, category: "sfx" });
    expect(registry.sound("amb_rain")).toMatchObject({ loop: true, category: "ambience" });
  });
  it("vfx reference sprites + particle params", () => {
    const v = registry.effect("campfire_sparks"); expect(v.sprite).toBe(registry.id("fx_spark")); expect(v).toMatchObject({ blend: "additive", anim: "idle", lifetime: 1.2 });
    expect(v.particles!.scaleCurve).toEqual([1, 0.6, 0]);
  });
  it("UI nine-slice and emissive page surface on frame refs", () => {
    const f = registry.frame(registry.id("ui_panel"), "idle", 0, 0); expect(f.nineSlice).toEqual({ l: 6, t: 6, r: 6, b: 6 });
    const b = registry.buildingFrame(registry.id("campfire"), 0, 0); expect(b.emissiveImage).toBe("buildings_emissive.png");
  });
  it("validation reports every new-kind issue", () => {
    const msg = issuesOf(mutate((m) => {
      m.sounds.push({ key: "bad_snd", files: ["x.txt"], volume: 2, pitchJitter: -1, category: "music" }, { key: "nofiles", files: [], category: "sfx" });
      m.vfx.push({ key: "bad_fx", sprite: "nope", lifetime: 0, blend: "screen", particles: { rate: -1, count: 0.5, speed: [3, 1], spread: 9, gravity: "x", fade: 1, scaleCurve: [] } });
      m.vfx.push({ key: "bad_anim", sprite: "fx_spark", anim: "explode", lifetime: 1 });
      m.atlases.find((a: { key: string }) => a.key === "ui").nineSlice["5"] = { l: 20, t: 0, r: 20, b: 0 };
      m.palettes.push({ key: "bad_pal", source: ["#000000", "#000000"], target: ["#zzzzzz"] }, { key: "bad_pal2", source: ["#000000", "#000000"], target: ["#zzzzzz", "#111111"] });
      m.tintSets.push({ key: "bad_tint", tints: ["red"] });
      m.variantSets.push({ key: "bad_set", base: "wood", variants: [{ key: "player_red", tint: "nope", palette: "nah", sprite: "ghost" }] });
      const wall = m.sprites.find((s: { key: string }) => s.key === "wall"); wall.building.frames = [[1, 2, 3]]; wall.building.layer = 7;
      m.sprites.find((s: { key: string }) => s.key === "wood").building = { piece: "wood", footprint: { w: 1, h: 1 }, layer: 0, frames: [[0, 0, 0, 0]] };
    }));
    for (const s of ["unsupported audio file", "volume must", "pitchJitter must", "category must be sfx", "at least one variant",
      "unknown sprite \"nope\"", "lifetime must", "blend must", "rate >= 0", "speed must", "spread must", "gravity must", "fade must", "scaleCurve must", "no animation \"explode\"",
      "nineSlice frame 5 out of range", "nineSlice 5 insets invalid", "equal-length", "colors must be #rrggbb", "duplicate source color", "tints must be", "base must be a character or zombie",
      "duplicate variant key", "unknown tint set", "unknown palette", "unknown sprite \"ghost\"", "needs 4 damage stages", "layer must be 0-3", "only building sprites"]) expect(msg).toContain(s);
  });
  it("legacy flat sprite lock is accepted and migrated", () => {
    const { lock } = loadManifest(sample, { lock: { player: 8 } }); expect(lock.sprites["player"]).toBe(8);
  });
});
