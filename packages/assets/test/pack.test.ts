import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadManifest, mergeManifests, CATEGORIES, type ManifestJson } from "../src/index.js";

// Real art pack (Cozy-Wild wave 1). Source of truth: assets/ (repo root) (tools/build_all.py).
const dir = fileURLToPath(new URL("../pack/", import.meta.url));
const sampleDir = fileURLToPath(new URL("../sample/", import.meta.url));
const pack = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
const lockFile = JSON.parse(readFileSync(dir + "ids.lock.json", "utf8"));
const sampleLock = JSON.parse(readFileSync(sampleDir + "ids.lock.json", "utf8"));
const pngSize = (f: string) => { const b = readFileSync(dir + f); expect(b.subarray(1, 4).toString()).toBe("PNG"); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

describe("art pack", () => {
  const { registry } = loadManifest(pack, { lock: lockFile });
  // ids.lock.json covers the merged runtime manifest (pack + sub-manifests, as apps/client/src/view.ts loads it).
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const subs = [["ui-kit", root + "assets/ui/kit/manifest.ui.kit.json"], ["branding", root + "assets/ui/branding/manifest.branding.json"], ["customization", dir + "customization/manifest.customization.json"], ["vehicles", dir + "vehicles/manifest.vehicles.json"]];
  const merged = mergeManifests([{ name: "pack", manifest: pack as ManifestJson }, ...subs.filter(([, f]) => existsSync(f!)).map(([name, f]) => ({ name: name!, manifest: JSON.parse(readFileSync(f!, "utf8")) as ManifestJson }))]);
  const { lock } = loadManifest(merged.manifest, { lock: lockFile });
  it("sub-manifests do not duplicate pack keys", () => expect(merged.collisions).toEqual([]));
  it("loads, covers every category, lock is up to date", () => {
    for (const c of CATEGORIES) expect(registry.byCategory(c).length).toBeGreaterThan(0);
    expect(lock).toEqual(lockFile);
  });
  it("keeps every sample key and id stable", () => {
    for (const [ns, keys] of Object.entries(sampleLock as Record<string, Record<string, number>>))
      for (const [k, id] of Object.entries(keys)) expect((lock as Record<string, Record<string, number>>)[ns]![k]).toBe(id);
  });
  it("atlas PNGs (and emissive pages) match the grid; sound files exist", () => {
    for (const a of registry.atlases.values()) {
      expect(pngSize(a.image)).toEqual({ w: a.frameW * a.columns, h: a.frameH * a.rows });
      if (a.emissiveImage) expect(pngSize(a.emissiveImage)).toEqual(pngSize(a.image));
    }
    for (const s of registry.sounds.values()) for (const f of s.files) expect(existsSync(dir + f)).toBe(true);
  });
  it("building sprites: 4 damage stages, mirror/unique4 rotation art", () => {
    for (const s of pack.sprites.filter((x: { building?: unknown }) => x.building)) {
      expect(["mirror", "unique4"]).toContain(s.rotationArt);
      if (s.rotationArt === "unique4") expect(s.building.frames.length).toBe(4); // may repeat rows: [r0,r1,r0,r1] keeps axis, no flip
      else expect(s.building.frames.length).toBeLessThanOrEqual(2); // true mirror: rot 2/3 = rows 0/1 + flipX
      const id = registry.id(s.key);
      for (let r = 0; r < 4; r++) for (let st = 0; st < 4; st++) expect(registry.buildingFrame(id, r, st).w).toBe(128);
    }
  });
  it("schema9: critter category, door states, ambience loop points", () => {
    expect(registry.byCategory("critter").map((s) => s.key)).toContain("critter_bunny");
    const door = registry.byKey("door");
    expect(door.building!.stateNames).toEqual(["closed", "open"]);
    expect(registry.buildingFrame(door.id, 1, 0, registry.stateIndex(door.id, "open")).frame).not.toBe(registry.buildingFrame(door.id, 1, 0).frame);
    expect(pack.sprites.some((s: { key: string }) => s.key === "door_open")).toBe(false);
    expect((lock as { sprites: Record<string, number> }).sprites["door_open"]).toBe(lockFile.sprites["door_open"]); // retired key keeps its id reserved
    for (const k of ["amb_campfire", "amb_rain", "amb_forest"]) {
      const snd = [...registry.sounds.values()].find((s) => s.key === k)!;
      expect(snd.loop).toBe(true); expect(snd.loopPoints!.end).toBeGreaterThan(snd.loopPoints!.start);
    }
  });
  it("wave 2: survival_fx keys yielded (ids reserved), aliases, masks", () => {
    for (const k of ["campfire", "torch_stand", "lantern", "fireplace", "wood_stove"]) {
      expect(pack.sprites.some((s: { key: string }) => s.key === k)).toBe(false);
      expect((lock as { sprites: Record<string, number> }).sprites[k] ?? lockFile.sprites[k]).toBe(lockFile.sprites[k]);
    }
    expect((lock as { sprites: Record<string, number> }).sprites["campfire"]).toBe(4);
    for (const k of ["door", "door_wood", "stone_spear", "wooden_club", "storage_box", "chest"]) expect(registry.byKey(k)).toBeDefined();
    expect(registry.byKey("player").atlas.masks.sheen).toBeDefined();
  });
  it("characters and zombies have 8 baked directions", () => {
    for (const k of ["player", "player_b", "player_c", "zombie_walker", "zombie_brute", "zombie_runner", "zombie_mummy", "zombie_pumpkin"]) {
      const s = registry.byKey(k);
      for (const a of s.animList) expect(a.directions).toBe(8);
      const walk = s.animations.get("walk")!; expect(registry.frame(s.id, "walk", Math.PI / 2, 0).frame).toBe(walk.frames[0]! + 2 * walk.dirStride);
    }
  });
});

describe("vehicles sub-manifest", () => {
  const vdir = dir + "vehicles/";
  const vm = JSON.parse(readFileSync(vdir + "manifest.vehicles.json", "utf8"));
  const size = (f: string) => { const b = readFileSync(vdir + f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  it("atlases match their grid, 2x pages <= 2048, masks share the 1x layout", () => {
    for (const a of vm.atlases) {
      expect(size(a.image)).toEqual({ w: a.frameW * a.columns, h: a.frameH * a.rows });
      const p2 = size(a.pages[0].image); expect(p2).toEqual({ w: a.frameW * a.columns * 2, h: a.frameH * a.rows * 2 });
      expect(Math.max(p2.w, p2.h)).toBeLessThanOrEqual(2048);
      for (const m of Object.values(a.masks) as string[]) expect(size(m)).toEqual(size(a.image));
    }
  });
  it("vehicles: 8 directions, snake_case attach, per-frame attach for every frame, lights + tow points", () => {
    const meta = new Map(vm.vehicles.map((v: { key: string }) => [v.key, v]));
    for (const s of vm.sprites.filter((x: { category: string }) => x.category !== "building")) {
      const v = meta.get(s.key) as { lights: { name: string; dirs: unknown[] }[]; family: string; states: string[] };
      expect(v).toBeDefined();
      for (const st of v.states) { expect(s.animations[st].directions).toBe(8); for (let d = 0; d < 8; d++) expect(s.frameAttach[String(s.animations[st].frames[0] + d)]).toBeDefined(); }
      for (const am of Object.values(s.frameAttach) as Record<string, unknown>[]) for (const n of Object.keys(am)) expect(n).toMatch(/^[a-z0-9_]+$/);
      if (v.family === "trailer" || (v.family === "camper" && !s.attach.driver)) expect(s.attach.hitch).toBeDefined(); else if (v.family !== "bicycle") { expect(s.attach.tow_hitch).toBeDefined(); expect(s.attach.driver).toBeDefined(); expect(s.attach.exhaust).toBeDefined(); }
      for (const l of v.lights) { expect(l.dirs.length).toBe(8); expect(s.attach[l.name]).toBeDefined(); }
    }
    for (const s of vm.sounds) for (const f of s.files) expect(existsSync(dir + f)).toBe(true);
  });
});
