import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { World, Transform } from "@engine/core";
import { loadManifest, mergeManifests, type ManifestJson } from "@engine/assets";
import { FireState, HearthFx, hearthParticles, VfxLayer } from "../src/index.js";
import type { AtlasManager } from "../src/assets/atlasManager.js";

const ROOT = join(__dirname, "../../..");
const json = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const bld = json<ManifestJson>("packages/assets/pack/building/manifest.building.json");
const base = json<ManifestJson>("packages/assets/pack/manifest.json");
const { registry: reg } = loadManifest(mergeManifests([{ name: "base", manifest: base }, { name: "building", manifest: bld }]).manifest);
const atlas = { registry: reg, pieceInfo: () => ({ fw: 1, fh: 1 }) } as unknown as AtlasManager;

describe("ADR-227 smaller campfire flames", () => {
  it("hearth embers start lower over a scaled flame; canvas particles scale too", () => {
    const run = (sc: number | undefined): number => {
      const w = new World(); w.register(Transform); const a = w.create(); w.add(a, Transform, { x: 1, y: 1, z: 0 });
      const h = new HearthFx(); let r = 0; h.rnd = () => { r = (r + 0.37) % 1; return r; }; const v = new VfxLayer();
      h.update(w, new Map([[a, FireState.Hearth]]), undefined, undefined, atlas, v, 0.5, sc === undefined ? undefined : () => sc);
      expect(v.active.length).toBeGreaterThan(0);
      return Math.max(...v.active.map((p) => p.z));
    };
    expect(run(0.55)).toBeLessThan(run(undefined));
    const big = hearthParticles(1, 3, 9, 64), small = hearthParticles(1, 3, 9, 64 * 0.55);
    expect(Math.min(...small.map((p) => p.dy))).toBeGreaterThan(Math.min(...big.map((p) => p.dy)));
  });
});
