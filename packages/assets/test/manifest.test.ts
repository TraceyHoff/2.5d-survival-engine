import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { World } from "@engine/core";
import { loadManifest, ManifestError, AssetRegistry, installAssetHash, CATEGORIES } from "../src/index.js";

const dir = fileURLToPath(new URL("../sample/", import.meta.url));
const sample = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
const pngSize = (f: string) => { const b = readFileSync(dir + f); expect(b.subarray(1, 4).toString()).toBe("PNG"); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

describe("asset manifest", () => {
  it("sample manifest loads, covers every category, atlases match PNG sizes", () => {
    const { registry } = loadManifest(sample);
    for (const c of CATEGORIES) expect(registry.byCategory(c).length).toBeGreaterThan(0);
    for (const a of registry.atlases.values()) expect(pngSize(a.image)).toEqual({ w: a.frameW * a.columns, h: a.frameH * a.rows });
  });
  it("stable ids via lock: adding a key never renumbers", () => {
    const a = loadManifest(sample);
    const more = structuredClone(sample); more.sprites.unshift({ ...more.sprites[0], key: "aaa_new_hero" });
    const b = loadManifest(more, { lock: a.lock });
    for (const [k, id] of Object.entries(a.lock)) expect(b.registry.id(k)).toBe(id);
    expect(b.registry.id("aaa_new_hero")).toBe(Math.max(...Object.values(a.lock)) + 1);
    expect(b.registry.hash).not.toBe(a.registry.hash);
  });
  it("animation frame resolution with 8 iso facings", () => {
    const { registry } = loadManifest(sample); const id = registry.id("player");
    expect(AssetRegistry.directionIndex(0, 8)).toBe(0); expect(AssetRegistry.directionIndex(Math.PI / 2, 8)).toBe(2); expect(AssetRegistry.directionIndex(-Math.PI / 2, 4)).toBe(3);
    const f = registry.frame(id, "walk", Math.PI / 2, 0.13); // frame index 1 of [2,3] -> 3, dir 2 -> +8
    expect(f.frame).toBe(3 + 2 * 4); expect([f.x, f.y, f.w, f.h]).toEqual([96, 96, 32, 48]); expect(f.anchorY).toBeCloseTo(48 * 0.92);
  });
  it("validation lists all issues", () => {
    const bad = { version: 1, atlases: [{ key: "a", image: "a.gif", frameW: 0, frameH: 8, columns: 1, rows: 1 }],
      sprites: [{ key: "Bad Key", category: "dragon", atlas: "zzz", animations: {} }, { key: "s", category: "item", atlas: "a", anchor: { x: 2, y: 0 }, animations: { idle: { frames: [5], fps: 0, directions: 3 } } }] };
    try { loadManifest(bad); throw new Error("no throw"); } catch (e) {
      expect(e).toBeInstanceOf(ManifestError); const msg = (e as ManifestError).issues.join("\n");
      for (const s of ["image must be", "frameW", "bad key", "unknown category", "unknown atlas", "at least one animation", "anchor", "directions", "fps", "out of atlas range"]) expect(msg).toContain(s);
    }
  });
  it("asset hash participates in the world schema hash", () => {
    const { registry } = loadManifest(sample); const a = new World(), b = new World();
    installAssetHash(a, registry); expect(a.getSchemaHash()).not.toBe(b.getSchemaHash());
    installAssetHash(b, registry); expect(a.getSchemaHash()).toBe(b.getSchemaHash());
  });
});
