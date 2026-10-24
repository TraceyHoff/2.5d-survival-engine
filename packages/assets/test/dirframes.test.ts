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
  it("accepts a dirFrames anchor outside its rect (finite, within the slack) and dirFrame() keeps it unclamped", () => {
    const m = veh(); const s = m.sprites.find((x: any) => Object.values<any>(x.animations).some((a) => a.dirFrames));
    const [name, a]: any = Object.entries<any>(s.animations).find(([, a]) => a.dirFrames);
    for (const d of a.dirFrames) d.anchor = { x: -0.5, y: 2.25 };
    const pack = JSON.parse(readFileSync(PACK_DIR + "manifest.json", "utf8"));
    const load = () => loadManifest(mergeManifests([{ name: "pack", manifest: pack }, { name: "vehicles", manifest: m }] as never).manifest);
    const { registry } = load();
    const ref = registry.dirFrame(registry.id(s.key), name, 0, 0);
    expect(ref.anchorX).toBeCloseTo(-0.5 * ref.w); expect(ref.anchorY).toBeCloseTo(2.25 * ref.h);
    a.dirFrames[0].anchor = { x: 0.5, y: Number.NaN }; expect(load).toThrow(/anchor must be finite/);
    a.dirFrames[0].anchor = { x: 0.5, y: 12 }; expect(load).toThrow(/anchor must be finite/);
  });
  it("frameMeta keyed by dirFrames entry (df:i) or rect, with legacy frame-index fallback", () => {
    const m = veh(); const s = m.sprites.find((x: any) => Object.values<any>(x.animations).some((a) => a.dirFrames));
    const [name, a]: any = Object.entries<any>(s.animations).find(([, a]) => a.dirFrames);
    const pack = JSON.parse(readFileSync(PACK_DIR + "manifest.json", "utf8"));
    const load = () => loadManifest(mergeManifests([{ name: "pack", manifest: pack }, { name: "vehicles", manifest: m }] as never).manifest);
    const d0 = a.dirFrames[0]; const hand = (x: number) => ({ anchors: { handR: { x, y: -1 } } });
    a.frameMeta = { "df:0": hand(1) };
    s.frameMeta = { ...(d0.rect ? { [`rect:${d0.atlas}/${d0.rect.x},${d0.rect.y},${d0.rect.w},${d0.rect.h}`]: hand(2) } : {}), "0": hand(3) };
    let { registry } = load(); const id = registry.id(s.key);
    expect(registry.dirFrameAnchors(id, name, 0)?.handR?.x).toBe(1); // anim df wins
    expect(registry.dirFrame(id, name, 0, 0).anchors?.handR?.x).toBe(1);
    delete a.frameMeta; ({ registry } = load());
    expect(registry.dirFrameAnchors(id, name, 0, 0)?.handR?.x).toBe(d0.rect ? 2 : 3); // rect, else legacy index
    a.frameMeta = { [`df:${a.dirFrames.length}`]: hand(1) }; expect(load).toThrow(/out of dirFrames range/);
    delete a.frameMeta; s.frameMeta = { "df:0": hand(1) }; expect(load).toThrow(/needs an anim with dirFrames/);
  });
});
