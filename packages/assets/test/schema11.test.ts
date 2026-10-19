import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, validateAssetFiles, ManifestError } from "../src/index.js";
import { FIXTURE_DIR, validateAssetFilesOnDisk, imageSizeOf } from "../src/node.js";

const sample = JSON.parse(readFileSync(FIXTURE_DIR + "manifest.json", "utf8"));
type M = typeof sample;
const mutate = (fn: (m: M) => void) => { const m = structuredClone(sample); fn(m); return m; };
const issuesOf = (json: unknown): string => { try { loadManifest(json); return ""; } catch (e) { return (e as ManifestError).issues.join("\n"); } };
const bld = (m: M): any => m.sprites.find((s: { category: string }) => s.category === "building");
const anySprite = (m: M): any => m.sprites.find((s: { category: string }) => s.category === "vfx") ?? m.sprites[0];

describe("clan palettes (two-tone tint)", () => {
  it("resolves by u8 index; validates colors and count", () => {
    const { registry } = loadManifest(mutate((m) => { m.clanPalettes = [{ key: "berry_cream", primary: "#E8475F", secondary: "#F6EAD2" }, { key: "sky_sun", primary: "#4F8FD6", secondary: "#FFD45A" }]; }));
    expect(registry.clanPalette(1)).toEqual({ index: 1, key: "sky_sun", primary: 0x4f8fd6, secondary: 0xffd45a }); expect(registry.clanPalette(5)).toBeUndefined();
    expect(issuesOf(mutate((m) => { m.clanPalettes = [{ key: "x", primary: "red", secondary: "#000000" }]; }))).toMatch(/primary and secondary/);
  });
});

describe("mask file checks", () => {
  it("missing and size-mismatched masks are reported (fake IO)", () => {
    const m = mutate((mm) => { mm.atlases[0].masks = { tintmask: "t.png", sheen: "s.png" }; });
    const { registry } = loadManifest(m); const img = m.atlases[0].image as string;
    const sizes: Record<string, { w: number; h: number }> = { [img]: { w: 256, h: 128 }, "t.png": { w: 128, h: 128 } };
    const out = validateAssetFiles(registry, { exists: (p) => p !== "s.png", imageSize: (p) => sizes[p] }).join("\n");
    expect(out).toMatch(/missing sheen mask s\.png/); expect(out).toMatch(/tintmask mask t\.png is 128x128, atlas image is 256x128/);
  });
  it("sample fixture and on-disk helper", () => {
    const { registry } = loadManifest(sample); expect(validateAssetFilesOnDisk(registry, FIXTURE_DIR)).toEqual([]);
    expect(imageSizeOf(FIXTURE_DIR + "nope.png")).toBeUndefined();
  });
});

describe("building anim rotations, crackOverlay, stateVfx", () => {
  it("rotations rows resolve with mirroring; legacy _r1 fallback", () => {
    const m = mutate((mm) => { const s = bld(mm); const f = s.building.frames[0][0]; const g = s.building.frames[0][1];
      s.animations = { ...s.animations, wave: { frames: [f, g], fps: 2, rotations: [[f, g], [g, f]] }, ring: { frames: [f], fps: 1 }, ring_r1: { frames: [g], fps: 1 } }; });
    const { registry } = loadManifest(m); const s = bld(m); const id = registry.id(s.key); const [f, g] = [s.building.frames[0][0], s.building.frames[0][1]];
    expect(registry.animFrame(id, "wave", 1, 0).frame).toBe(g); const r3 = registry.animFrame(id, "wave", 3, 0.6); expect(r3.frame).toBe(f); expect(r3.flipX).toBe(true);
    expect(registry.animFrame(id, "ring", 1, 0).frame).toBe(g); expect(registry.animFrame(id, "ring", 0, 0).frame).toBe(f);
    expect(issuesOf(mutate((mm) => { const s2 = bld(mm); s2.animations.wave = { frames: [0, 1], fps: 1, rotations: [[0], [1, 0]] }; }))).toMatch(/rotation row 0 must have 2 frames/);
    expect(issuesOf(mutate((mm) => { const s2 = anySprite(mm); s2.animations = { a: { frames: [0], fps: 1, rotations: [[0]] } }; }))).toMatch(/rotations only apply to building/);
  });
  it("crackOverlay + stateVfx resolve to ids and validate refs", () => {
    const m = mutate((mm) => {
      const v = anySprite(mm); const f0 = Object.values(v.animations as Record<string, { frames: number[] }>)[0]!.frames[0];
      mm.sprites.push({ ...v, key: "crack_1x1", animations: { stage1: { frames: [f0], fps: 1 }, stage2: { frames: [f0], fps: 1 }, stage3: { frames: [f0], fps: 1 } } });
      mm.vfx.push({ key: "raid_fire", sprite: v.key, lifetime: 1 }, { key: "raid_smoke", sprite: v.key, lifetime: 1, stretch: "velocity", stretchMax: 3 });
      const s = bld(mm); s.attach = { fire: { x: 0, y: -10 }, smoke: { x: 2, y: -30 } }; s.building.crackOverlay = "crack_1x1";
      s.building.stateVfx = { burning: [{ vfx: "raid_fire", attach: "fire" }, { vfx: "raid_smoke", attach: "smoke" }] };
    });
    const { registry, warnings } = loadManifest(m); expect(warnings).toEqual([]); const b = registry.byKey(bld(m).key).building!;
    expect(b.crackOverlay).toBe(registry.id("crack_1x1")); expect(b.stateVfx.burning!.map((e) => e.attach)).toEqual(["fire", "smoke"]);
    expect(registry.effect("raid_smoke")).toMatchObject({ stretch: "velocity", stretchMax: 3 }); expect(registry.effect("raid_fire").stretch).toBe("none");
    const bad = (fn: (mm: M) => void) => issuesOf(mutate((mm) => { fn(mm); }));
    expect(bad((mm) => { bld(mm).building.crackOverlay = "nope"; })).toMatch(/unknown crackOverlay/);
    expect(bad((mm) => { bld(mm).building.crackOverlay = anySprite(mm).key; })).toMatch(/lacks animation "stage1"/);
    expect(bad((mm) => { bld(mm).building.stateVfx = { burning: [{ vfx: "zzz", attach: "fire" }] }; })).toMatch(/unknown vfx "zzz"[\s\S]*unknown attach point "fire"/);
    expect(bad((mm) => { mm.vfx[0].stretch = "spin"; })).toMatch(/stretch must be none\|velocity/);
  });
});

describe("decal autotile", () => {
  it("first matching rule wins, fallback required, decal-only", () => {
    const m = mutate((mm) => { const v = anySprite(mm); mm.sprites.push({ ...v, key: "territory_edge", category: "decal",
      autotile: { neighbors: 4, group: "territory", rules: [{ mask: 0b1111, frame: 0 }, { mask: 0b0001, care: 0b0001, frame: 1 }, { mask: 0, care: 0, frame: 2 }] } }); });
    const { registry } = loadManifest(m); const id = registry.id("territory_edge");
    expect(registry.decalFrame(id, 15)!.frame).toBe(0); expect(registry.decalFrame(id, 0b0101)!.frame).toBe(1); expect(registry.decalFrame(id, 0b0100)!.frame).toBe(2);
    expect(registry.byKey("territory_edge").autotile!.group).toBe("territory");
    const bad = (a: unknown, cat = "decal") => issuesOf(mutate((mm) => { mm.sprites.push({ ...anySprite(mm), key: "d1", category: cat, autotile: a }); }));
    expect(bad({ neighbors: 4, rules: [{ mask: 1, frame: 0 }] })).toMatch(/fallback rule/);
    expect(bad({ neighbors: 4, rules: [{ mask: 16, care: 0, frame: 0 }] })).toMatch(/within 0\.\.15/);
    expect(bad({ neighbors: 6, rules: [] })).toMatch(/neighbors must be 4 or 8/);
    expect(bad({ neighbors: 4, rules: [{ mask: 0, care: 0, frame: 0 }] }, "vfx")).toMatch(/only decal sprites/);
  });
});
