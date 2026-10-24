import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, type AssetRegistry } from "@engine/assets";
import { PACK_DIR } from "@engine/assets/node";
import { mergeManifests } from "@engine/assets";
import { AtlasManager, legacyDirFrameAtlases, sourcesFromManifest } from "../src/assets/atlasManager.js";

const json = (p: string) => JSON.parse(readFileSync(PACK_DIR + p, "utf8"));
const merged = (...packs: [string, string][]): AssetRegistry => loadManifest(mergeManifests(packs.map(([name, p]) => ({ name, manifest: json(p) })) as never).manifest).registry;

/** AtlasManager without GL: just the sprite/atlas tables resolve() and the page lookups read. */
function tables(reg: AssetRegistry, lazy: (key: string) => boolean = () => true): AtlasManager {
  const am = Object.create(AtlasManager.prototype) as any; let base = 0;
  am.atlases = [...reg.atlases.values()].sort((a, b) => a.id - b.id).map((a) => { const r = { key: a.key, id: a.id, source: { url: a.key }, base, count: a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns, ...(lazy(a.key) ? { lazy: { w1: 0, h1: 0, state: 0, pool: 0 } } : {}) }; base += r.count; return r; });
  am.sprites = []; for (const s of reg.allSprites()) am.sprites[s.id] = { atlasIdx: am.atlases.findIndex((x: any) => x.id === s.atlas.id), anchorX: s.anchor.x, anchorY: s.anchor.y, anims: s.animList, dirAt: s.animList.map((an) => an.dirFrames ? Int32Array.from(an.dirFrames, (d) => am.atlases.findIndex((x: any) => x.id === d.atlas.id)) : null), stateAnim: new Int16Array(8), damage: [] };
  return am as AtlasManager;
}
const out = () => ({ entry: 0, w: 0, h: 0, ax: 0, ay: 0, hasDamageFrames: false, flipX: false, sprite: -1, frame: -1, anim: "" }) as any;

describe("facing-split vehicle art (dirFrames, Art 62e55cf/64a18d2)", () => {
  const reg = merged(["pack", "manifest.json"], ["vehicles", "vehicles/manifest.vehicles.json"]);
  const split = [...reg.allSprites()].filter((s) => s.animList.some((a) => a.dirFrames));
  // vehicles split every anim by facing; animals (boar/wolf/deer) split only swim, so the facing-page checks are veh_-only
  const vsplit = split.filter((s) => s.animList.some((a) => /^veh_/.test(a.dirFrames?.[0]?.atlas.key ?? "")));

  it("resolve() matches AssetRegistry.dirFrame() for every facing (page, frame, anchor) and frame() without dirFrames", () => {
    const am = tables(reg); expect(split.length).toBeGreaterThan(0); let n = 0;
    for (const s of reg.allSprites()) { const a = s.animList[0]!; if (a.directions !== 8) continue;
      for (let d = 0; d < 8; d++) { const f = (d / 8) * Math.PI * 2; const ref = reg.dirFrame(s.id, a.name, f, 0); const r = out();
        expect(am.resolve(s.id, 0, f, 0, 0, r)).toBe(true);
        const at = (am as any).atlases.find((x: any) => x.id === ref.atlas.id);
        expect(r.entry).toBe(at.base + ref.frame); expect(r.ax).toBeCloseTo(ref.anchorX, 5); expect(r.ay).toBeCloseTo(ref.anchorY, 5); n++;
        if (!a.dirFrames) expect(ref.atlas.id).toBe(reg.frame(s.id, a.name, f, 0).atlas.id);
      } }
    expect(n).toBeGreaterThan(split.length * 8 - 1);
  });

  it("streams and refcounts the facing's page, never the legacy full-size page", () => {
    const am = tables(reg); const legacy = legacyDirFrameAtlases(reg);
    expect(vsplit.length).toBeGreaterThan(0);
    for (const s of vsplit) { const keys = new Set<string>();
      for (let d = 0; d < 8; d++) { const f = (d / 8) * Math.PI * 2; const k = am.pageKeyAt(s.id, f)!; expect(k).toBe(reg.dirFrame(s.id, s.animList[0]!.name, f, 0).atlas.key); expect(legacy.has(k)).toBe(false); keys.add(k); }
      expect(am.pageKeyAt(s.id)).toBe(am.pageKeyAt(s.id, 0)); expect(keys.size).toBeGreaterThan(1); }
  });

  it("legacy pages = the old full-size sheets: referenced by nothing that draws", () => {
    const legacy = legacyDirFrameAtlases(reg);
    // Art 36528cf repoints split sprites' `atlas` at a facing page (old full-size sheets deleted): the legacy set is then
    // empty. Until that manifest lands, the pre-split shape (legacy = the split sprites' sheets) is still accepted.
    if (legacy.size === 0 || !legacy.has("veh_art_truck_box")) {
      expect(legacy.size).toBe(0);
      for (const s of vsplit) expect(s.atlas.key).toMatch(/_f[hvd]\d+$/);
    } else expect([...legacy].sort()).toEqual([...new Set(vsplit.map((s) => s.atlas.key))].sort());
    for (const s of reg.allSprites()) { if (!s.animList.some((a) => a.dirFrames)) expect(legacy.has(s.atlas.key)).toBe(false);
      for (const a of s.animList) for (const d of a.dirFrames ?? []) expect(legacy.has(d.atlas.key)).toBe(false); }
    // pool slots are sized by the facing pages only: all <= 1008px at 1x (4 per 2048 layer)
    const live = [...reg.atlases.values()].filter((a) => /^veh_art_/.test(a.key) && !legacy.has(a.key));
    const big = live.filter((a) => Math.max(a.columns * a.frameW, a.rows * a.frameH) > 1020).map((a) => a.key);
    expect(big).toEqual([]);
  });
});

describe("body pages 20x14 (Art 64a18d2)", () => {
  const reg = merged(["pack", "manifest.json"], ["customization", "customization/manifest.customization.json"]);
  it("@2x pages fit a 2048 layer and carry the @2x tint mask KTX2 through sourcesFromManifest", () => {
    const src = sourcesFromManifest(reg, "/art/pack/customization/manifest.customization.json"); let n = 0;
    const dims = new Set<string>();
    for (const a of reg.atlases.values()) { if (!/^body_/.test(a.key)) continue; n++;
      // Art 118: rect-packed body pages (one per body type, same size so they share the body pool slot), <= 1016 px
      const w = a.columns * a.frameW, h = a.rows * a.frameH; dims.add(`${w}x${h}`); expect(Math.max(w, h)).toBeLessThanOrEqual(1016); expect(w * h).toBeLessThanOrEqual(1016 * 1016); // ADR-128 gather anims: still one @2x page per 2048 layer
      const p2 = src.get(a.key)!.pages!.find((p) => p.scale === 2)!; expect(p2.ktx2).toMatch(/@2x\.ktx2$/); expect(p2.masksKtx2?.tintmask).toMatch(/tintmask@2x\.ktx2$/); }
    expect(n).toBe(2); expect(dims.size).toBe(1);
  });
  it("bodies pool at 2x only when the quality tier asks for it", () => {
    const am = Object.create(AtlasManager.prototype) as any; Object.defineProperty(am, "layerSize", { value: 2048 });
    const src = sourcesFromManifest(reg, "/m.json"); const lazy = [...reg.atlases.values()].filter((a) => /^body_/.test(a.key)).map((a) => ({ key: a.key, source: src.get(a.key), lazy: { w1: 880, h1: 840 } }));
    am.pageScale = 2; expect(am.poolScales(lazy)).toEqual([2, 1]); am.pageScale = 1; expect(am.poolScales(lazy)).toEqual([1]);
    const g = am.poolGeom(lazy, 2); expect([g.sw, g.sh, g.perLayer]).toEqual([1760, 1680, 1]);
  });
});

describe("pool slot alignment (wear / tail pools)", () => {
  it("pitch is 16-aligned at every scale, so mip levels 0..2 of every slot start on a 4x4 block", () => {
    const am = Object.create(AtlasManager.prototype) as any; Object.defineProperty(am, "layerSize", { value: 2048 });
    for (const [w1, h1] of [[333, 517], [1020, 969], [880, 840], [255, 255], [1001, 3]]) for (const k of [0.25, 0.5, 1, 2]) {
      const g = am.poolGeom([{ lazy: { w1, h1 } }], k); if (!g.perLayer) continue;
      expect(g.pw % 16).toBe(0); expect(g.ph % 16).toBe(0); expect(g.sw % 4).toBe(0); expect(g.sh % 4).toBe(0);
      for (let c = 0; c < g.cols; c++) for (let l = 0; l < 3; l++) expect(((c * g.pw) >> l) % 4).toBe(0);
      expect((g.cols - 1) * g.pw + g.sw).toBeLessThanOrEqual(2048);
    }
  });
});
