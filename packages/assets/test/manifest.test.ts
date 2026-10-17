import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { World } from "@engine/core";
import { loadManifest, ManifestError, installAssetHash, CATEGORIES } from "../src/index.js";
import { loadDefaultManifest, PACK_DIR } from "../src/node.js";

// sample/ is the placeholder FIXTURE; the default content is pack/.
const dir = fileURLToPath(new URL("../sample/", import.meta.url));
const sample = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
const pngSize = (f: string) => { const b = readFileSync(dir + f); expect(b.subarray(1, 4).toString()).toBe("PNG"); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

describe("asset manifest", () => {
  it("default (pack) manifest loads and covers every required category; fixture atlases match PNG sizes", () => {
    const def = loadDefaultManifest(); for (const c of CATEGORIES) expect(def.registry.byCategory(c).length).toBeGreaterThan(0);
    expect(def.dir.endsWith("/pack/")).toBe(true);
    const { registry } = loadManifest(sample);
    for (const c of CATEGORIES) expect(registry.byCategory(c).length).toBeGreaterThan(0);
    for (const a of registry.atlases.values()) { expect(pngSize(a.image)).toEqual({ w: a.frameW * a.columns, h: a.frameH * a.rows }); if (a.emissiveImage) expect(pngSize(a.emissiveImage)).toEqual(pngSize(a.image)); }
  });
  it("stable ids via lock: adding a key never renumbers (default pack)", () => {
    const pack = JSON.parse(readFileSync(PACK_DIR + "manifest.json", "utf8"));
    const a = loadManifest(pack);
    const more = structuredClone(pack); more.sprites.unshift({ ...more.sprites[0], key: "aaa_new_hero" });
    const b = loadManifest(more, { lock: a.lock });
    for (const [k, id] of Object.entries(a.lock.sprites)) expect(b.registry.id(k)).toBe(id);
    expect(b.registry.id("aaa_new_hero")).toBe(Math.max(...Object.values(a.lock.sprites)) + 1);
    expect(b.registry.hash).not.toBe(a.registry.hash);
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
