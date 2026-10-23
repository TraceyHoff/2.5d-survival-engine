import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultAppearance, directionIndex4, directionIndex8, layerForFacing, normalizeOutline, resolveLayers, slotIndex, validateAppearance, DEFAULT_TINT_NEUTRAL } from "@engine/core";
import { AssetRegistry, loadManifest, ManifestError } from "../src/index.js";

const dir = fileURLToPath(new URL("../sample/", import.meta.url));
const sample = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;
function base(edit?: (m: M) => void): M {
  const m: M = structuredClone(sample);
  const ch = m.atlases.find((a: M) => a.key === m.sprites.find((s: M) => s.key === "player").atlas); ch.masks = { ...(ch.masks ?? {}), tintmask: "characters_tint.png" };
  const player = m.sprites.find((s: M) => s.key === "player");
  for (const k of ["body_male", "body_female", "hair_short_m", "hair_short_f", "hair_short_m_hat", "hat_cap", "hat_helm", "top_shirt", "shoes_boots", "top_sleeve_back", "top_sleeve_front", "face_round", "eyes_dot"]) m.sprites.push({ ...structuredClone(player), key: k });
  m.bodyTypes = { male: { sprite: "body_male" }, female: { sprite: "body_female" } };
  m.skinTones = [{ key: "light", color: "#f1c27d" }, { key: "dark", color: "#8d5524" }];
  m.hairColors = [{ key: "black", color: "#111111" }, { key: "blond", color: "#e6c35c" }];
  m.clothingColors = [{ key: "red", color: "#aa2222" }, { key: "blue", color: "#2244aa" }, { key: "white", color: "#ffffff" }];
  m.wearables = [
    { key: "hair_short", slot: "hair", layer: 40, layerByDir: [40, 40, 40, 5], tintChannels: 1, bodies: { male: { sprite: "hair_short_m", hatHair: { sprite: "hair_short_m_hat" } }, female: { sprite: "hair_short_f" } } },
    { key: "hat_cap", slot: "hat", layer: 50, tintChannels: 2, hatHair: true, bodies: { male: { sprite: "hat_cap" }, female: { sprite: "hat_cap" } } },
    { key: "hat_helm", slot: "hat", layer: 50, hidesSlots: ["hair"], unlockTags: ["raid_reward"], bodies: { male: { sprite: "hat_helm" } } },
    { key: "top_shirt", slot: "top", layer: 20, tintChannels: 2, bodies: { male: { sprite: "top_shirt" }, female: { sprite: "top_shirt" } } },
    { key: "shoes_boots", slot: "shoes", layer: 15, z: 1, bodies: { male: { sprite: "shoes_boots" }, female: { sprite: "shoes_boots" } } },
  ];
  edit?.(m); return m;
}
const issues = (m: M): string[] => { try { loadManifest(m); return []; } catch (e) { if (e instanceof ManifestError) return e.issues; throw e; } };


const E = 0, SE = Math.PI / 4, S = Math.PI / 2, N = -Math.PI / 2, NE = -Math.PI / 4;
const W = (k: string, extra: M = {}) => ({ key: k, slot: "top", layer: 20, bodies: { male: { sprite: "top_shirt" }, female: { sprite: "top_shirt" } }, ...extra });

describe("cosmetics contract extensions (ADR-082)", () => {
  it("directionIndex8 matches AssetRegistry.directionIndex(f, 8); 4 and 8 entry layerByDir", () => {
    for (let i = 0; i < 64; i++) { const f = -7 + i * 0.23; expect(directionIndex8(f)).toBe(AssetRegistry.directionIndex(f, 8)); expect(directionIndex4(f)).toBe(AssetRegistry.directionIndex(f, 4)); }
    expect(layerForFacing({ layer: 1, layerByDir: [10, 20, 30, 40] }, N)).toBe(40);
    expect(layerForFacing({ layer: 1, layerByDir: [0, 1, 2, 3, 4, 5, 6, 7] }, SE)).toBe(1);
    expect(layerForFacing({ layer: 1, layerByDir: [0, 1, 2, 3, 4, 5, 6, 7] }, NE)).toBe(7);
    const cat = loadManifest(base((m) => { m.wearables[0].layerByDir = { N: 5, NE: 6, NW: 7 }; })).registry.cosmetics!;
    expect(cat.byKey("hair_short")!.layerByDir).toEqual([40, 40, 40, 40, 40, 7, 5, 6]);
    const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = cat.byKey("hair_short")!.id;
    expect(resolveLayers(cat, a, NE).find((l) => l.slot === "hair")!.layer).toBe(6);
    expect(resolveLayers(cat, a, S).find((l) => l.slot === "hair")!.layer).toBe(40);
    expect(issues(base((m) => { m.wearables[0].layerByDir = [1, 2, 3]; }))).toContainEqual(expect.stringContaining("layerByDir must be 4 integers"));
    expect(issues(base((m) => { m.wearables[0].layerByDir = { UP: 1 }; }))).toContainEqual(expect.stringContaining('unknown direction "UP"'));
  });

  it("multi-layer wearables emit one sorted DrawLayer per layer; single form unchanged", () => {
    const cat = loadManifest(base((m) => m.wearables.push(W("top_jacket", { tintChannels: 1, layer: undefined, bodies: undefined, layers: [
      { name: "sleeve_back", layer: 5, layerByDir: [5, 5, 5, 25], bodies: { male: { sprite: "top_sleeve_back" }, female: { sprite: "top_sleeve_back" } }, outline: "none" },
      { name: "sleeve_front", layer: 25, tintChannels: 2, z: 1, bodies: { male: { sprite: "top_sleeve_front" }, female: { sprite: "top_sleeve_front" } } },
    ] })))).registry.cosmetics!;
    const j = cat.byKey("top_jacket")!; expect(j.layer).toBe(5); expect(j.layers!.map((l) => l.name)).toEqual(["sleeve_back", "sleeve_front"]);
    expect(j.layers![0]!.tintChannels).toBe(1); expect(j.layers![1]!.tintChannels).toBe(2); expect(j.bodies.male).toBeDefined();
    const a = defaultAppearance(cat); a.parts[slotIndex("top")] = j.id;
    const ls = resolveLayers(cat, a, S);
    expect(ls.map((l) => l.layerName ?? l.slot)).toEqual(["sleeve_back", "body", "sleeve_front"]);
    expect(ls[0]!.outlineMode).toBe("none"); expect(ls[0]!.outline).toBe(false); expect(ls[0]!.tintG).toBeUndefined(); expect(ls[2]!.tintG).toBeDefined();
    expect(resolveLayers(cat, a, N).map((l) => l.layerName ?? l.slot)).toEqual(["body", "sleeve_back", "sleeve_front"]);
    a.parts[slotIndex("top")] = cat.byKey("top_shirt")!.id; const one = resolveLayers(cat, a, S).find((l) => l.slot === "top")!;
    expect(one.layerName).toBeUndefined(); expect(one.layer).toBe(20);
    const bad = issues(base((m) => m.wearables.push(W("top_x", { layers: [{ name: "a", layer: 1, bodies: { male: { sprite: "top_shirt" } } }, { name: "a", layer: 2, bodies: { female: { sprite: "top_shirt" } } }] }))));
    expect(bad).toContainEqual(expect.stringContaining("duplicate layer name"));
    expect(bad).toContainEqual(expect.stringContaining("same body types as layers[0]"));
    expect(issues(base((m) => m.wearables.push(W("top_y", { layers: [] }))))).toContainEqual(expect.stringContaining("layers must be a non-empty array"));
  });

  it("outline enum accepts legacy booleans", () => {
    expect([normalizeOutline(true), normalizeOutline(false), normalizeOutline("none"), normalizeOutline(undefined)]).toEqual(["body", "none", "none", undefined]);
    const cat = loadManifest(base((m) => { m.wearables[3].outline = false; m.wearables[4].outline = "body"; })).registry.cosmetics!;
    expect(cat.byKey("top_shirt")).toMatchObject({ outline: false, outlineMode: "none" });
    expect(cat.byKey("shoes_boots")).toMatchObject({ outline: true, outlineMode: "body" });
    expect(issues(base((m) => { m.wearables[3].outline = "maybe"; }))).toContainEqual(expect.stringContaining('outline must be "body" | "none"'));
  });

  it("tint: multiply default, tintNeutral 0.78 overridable per manifest / wearable / layer", () => {
    expect(DEFAULT_TINT_NEUTRAL).toBe(0.78);
    let cat = loadManifest(base()).registry.cosmetics!; const a = defaultAppearance(cat); a.parts[slotIndex("top")] = cat.byKey("top_shirt")!.id;
    let ls = resolveLayers(cat, a, S);
    expect(ls.find((l) => l.slot === "body")!.tintNeutral).toBe(0.78); expect(ls.find((l) => l.slot === "top")!.tintNeutral).toBe(0.78);
    expect(ls.find((l) => l.slot === "top")!.tintMode).toBeUndefined();
    cat = loadManifest(base((m) => { m.tintNeutral = 0.5; m.wearables[3].tintNeutral = 0.6; })).registry.cosmetics!; ls = resolveLayers(cat, a, S);
    expect(ls.find((l) => l.slot === "body")!.tintNeutral).toBe(0.5); expect(ls.find((l) => l.slot === "top")!.tintNeutral).toBe(0.6);
    expect(issues(base((m) => { m.tintNeutral = 0; }))).toContainEqual("tintNeutral must be a number in (0,1]");
  });

  it("cosmeticDefaults + requiredSlots fill face/eyes; displayName/locKey", () => {
    const mk = (edit?: (m: M) => void) => base((m) => {
      m.wearables.push({ key: "face_round", slot: "face", layer: 32, bodies: { male: { sprite: "face_round" }, female: { sprite: "face_round" } }, displayName: "Round", locKey: "cz.face_round" });
      m.wearables.push({ key: "eyes_dot", slot: "eyes", layer: 34, bodies: { male: { sprite: "eyes_dot" }, female: { sprite: "eyes_dot" } } });
      for (const b of ["male", "female"]) m.bodyTypes[b] = { ...m.bodyTypes[b], displayName: b, locKey: `cz.body.${b}`, cosmeticDefaults: { face: "face_round", eyes: "eyes_dot", hair: "hair_short" } };
      edit?.(m);
    });
    const cat = loadManifest(mk()).registry.cosmetics!;
    expect(cat.requiredSlots).toEqual(["face", "eyes"]); expect(cat.bodyType("female")).toMatchObject({ displayName: "female", locKey: "cz.body.female" });
    expect(cat.byKey("face_round")).toMatchObject({ displayName: "Round", locKey: "cz.face_round" });
    const d = defaultAppearance(cat, 1);
    expect(d.parts[slotIndex("face")]).toBe(cat.byKey("face_round")!.id); expect(d.parts[slotIndex("hair")]).toBe(cat.byKey("hair_short")!.id);
    const empty = { ...defaultAppearance(undefined, 0), skinTone: 0 };
    const r = validateAppearance(cat, empty, { mode: "reject" });
    expect(r.issues).toEqual([]); expect(r.value!.parts[slotIndex("eyes")]).toBe(cat.byKey("eyes_dot")!.id);
    expect(issues(mk((m) => { m.bodyTypes.male.cosmeticDefaults = { face: "hair_short", eyes: "nope" }; }))).toEqual(expect.arrayContaining([
      expect.stringContaining("hair_short belongs to slot hair"), expect.stringContaining('unknown wearable "nope"'), expect.stringContaining("cosmeticDefaults.face is missing")]));
    // no defaults declared -> nothing required (backward compatible)
    expect(loadManifest(base()).registry.cosmetics!.requiredSlots).toEqual([]);
  });

  it("face expressions: per-anim faceAnims, runtime expression override, fallback", () => {
    const cat = loadManifest(base((m) => {
      m.faceAnims = { walk: "idle" };
      m.wearables.push({ key: "face_round", slot: "face", layer: 32, tintChannels: 1, faceAnims: { idle: "walk" }, bodies: { male: { sprite: "face_round" }, female: { sprite: "face_round" } },
        expressions: { ouch: { male: { sprite: "eyes_dot", anim: "walk" } } } });
    })).registry.cosmetics!;
    const f = cat.byKey("face_round")!; expect(Object.keys(f.expressions!).sort()).toEqual(["idle", "ouch", "walk"]);
    const a = defaultAppearance(cat); a.parts[slotIndex("face")] = f.id;
    const face = (o?: M) => resolveLayers(cat, a, S, o).find((l) => l.slot === "face")!;
    expect(face()).toMatchObject({ anim: "idle" }); expect(face().expression).toBeUndefined();
    expect(face({ anim: "idle" })).toMatchObject({ anim: "walk", expression: "walk" });
    expect(face({ anim: "idle", expression: "ouch" })).toMatchObject({ anim: "walk", expression: "ouch" });
    expect(face({ expression: "unknown" }).expression).toBeUndefined();
    a.bodyType = 1; expect(face({ expression: "ouch" }).expression).toBeUndefined(); // ouch has no female art
    expect(issues(base((m) => m.wearables.push({ ...W("top_z"), faceAnims: { idle: "smile" } })))).toContainEqual(expect.stringContaining("only valid on face and eyes"));
    expect(issues(base((m) => m.wearables.push({ key: "face_q", slot: "face", layer: 32, faceAnims: { idle: "smile" }, bodies: { male: { sprite: "face_round" } } })))).toContainEqual(expect.stringContaining('unknown expression "smile"'));
  });

  it("frameMeta anchors: registry accessor, anim override, flipX mirroring, validation", () => {
    const { registry } = loadManifest(base((m) => {
      const s = m.sprites.find((x: M) => x.key === "body_male");
      s.frameMeta = { 0: { anchors: { handR: { x: 4, y: -20, angle: 10, len: 0.8, behind: false }, head: { x: 0, y: -40, z: 2 } } } };
      s.animations.idle.frameMeta = { 0: { anchors: { handR: { x: 5, y: -21 } } } };
    }));
    const id = registry.ids.sprites.id("body_male");
    expect(registry.frameAnchors(id, 0)!.handR).toMatchObject({ x: 4, angle: 10 });
    expect(registry.frameAnchors(id, 0, "idle")!.handR).toEqual({ x: 5, y: -21 }); expect(registry.frameAnchors(id, 0, "idle")!.head!.z).toBe(2);
    expect(registry.frameAnchors(id, 1)).toBeUndefined();
    const ref = registry.frame(id, "walk", E, 0); expect(ref.anchors).toBeUndefined();
    const r0 = registry.frame(id, "idle", E, 0); expect(AssetRegistry.anchorPoint(r0, "handR")).toEqual({ x: 5, y: -21 });
    expect(AssetRegistry.anchorPoint({ ...r0, flipX: true, anchors: { h: { x: 3, y: 1, angle: 15 } } }, "h")).toEqual({ x: -3, y: 1, angle: -15 });
    const bad = issues(base((m) => { m.sprites.find((x: M) => x.key === "body_male").frameMeta = { 99999: {}, 0: { anchors: { handR: { x: 1, y: 1, angle: "x", behind: 1 } }, foo: 1 } }; }));
    for (const s of ["frame 99999 out of atlas range", "angle must be a finite number", "behind must be a boolean", 'unknown key "foo"']) expect(bad).toContainEqual(expect.stringContaining(s));
  });
});

const art = fileURLToPath(new URL("../pack/manifest.json", import.meta.url));
describe("shipped pack validates against the extended schema", () => {
  it("loads with 0 warnings and all wearables", () => {
    const pack = JSON.parse(readFileSync(art, "utf8"));
    const warn: string[] = []; const orig = console.warn; console.warn = (...a: unknown[]) => { warn.push(a.join(" ")); };
    try {
      const r = loadManifest(pack, { lock: JSON.parse(readFileSync(fileURLToPath(new URL("../pack/ids.lock.json", import.meta.url)), "utf8")) });
      expect(r.warnings).toEqual([]); expect(warn).toEqual([]);
      if (pack.wearables) expect(r.registry.cosmetics!.size).toBe(pack.wearables.length);
    } finally { console.warn = orig; }
  });
});
