import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest } from "../src/index.js";
import { PACK_DIR } from "../src/node.js";
import { mergeManifests } from "../src/merge.js";

const veh = () => JSON.parse(readFileSync(PACK_DIR + "vehicles/manifest.vehicles.json", "utf8"));

describe("facing-split dirFrames (vehicles)", () => {
  it("every dirFrame resolves to a <=1008px 1x page and dirFrame() uses it", () => {
    const m = veh(); const pack = JSON.parse(readFileSync(PACK_DIR + "manifest.json", "utf8"));
    const { registry } = loadManifest(mergeManifests([{ name: "pack", manifest: pack }, { name: "vehicles", manifest: m }] as never).manifest);
    let n = 0;
    for (const s of m.sprites) for (const [name, a] of Object.entries<any>(s.animations)) {
      if (!a.dirFrames) continue;
      const id = registry.id(s.key);
      for (let d = 0; d < a.directions; d++) {
        const ref = registry.dirFrame(id, name, (d / a.directions) * Math.PI * 2, 0);
        expect(Math.max(ref.atlas.columns * ref.atlas.frameW, ref.atlas.rows * ref.atlas.frameH)).toBeLessThanOrEqual(1008); n++;
      }
    }
    expect(n).toBeGreaterThan(0);
    // legacy full-size pages are gone: every veh_art_ page fits a quarter of a 2048 layer
    for (const a of m.atlases) if (/^veh_art_/.test(a.key)) expect(Math.max(a.frameW * a.columns, a.frameH * a.rows)).toBeLessThanOrEqual(1024);
  });
  it("rejects a dirFrames entry with an unknown atlas or wrong length", () => {
    const m = veh(); const s = m.sprites.find((x: any) => Object.values<any>(x.animations).some((a) => a.dirFrames));
    const a: any = Object.values<any>(s.animations).find((a) => a.dirFrames); a.dirFrames[0] = { ...a.dirFrames[0], atlas: "nope" };
    expect(() => loadManifest(m)).toThrow(/unknown atlas/);
    a.dirFrames.pop(); expect(() => loadManifest(m)).toThrow(/dirFrames must have/);
  });
});
