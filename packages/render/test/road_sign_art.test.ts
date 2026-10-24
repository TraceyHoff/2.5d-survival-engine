// ADR-119/120: road autotiles draw flat (both renderers) and signs show their idle_r<rot> facing, not always frame 0.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, mergeManifests, type AssetRegistry } from "@engine/assets";
import { PACK_DIR } from "@engine/assets/node";
import { AtlasManager } from "../src/assets/atlasManager.js";
import { animFrameId, frameAnim, frameIdForAnim, signFacingAnim, FRAME_ANIM } from "../src/frame-select.js";
import { flatSortDepth } from "../src/canvas2d.js";

const json = (p: string) => JSON.parse(readFileSync(PACK_DIR + p, "utf8"));
const reg: AssetRegistry = loadManifest(mergeManifests([{ name: "nature", manifest: json("nature/manifest.nature.json") }] as never).manifest).registry;
function tables(r: AssetRegistry): AtlasManager {
  const am = Object.create(AtlasManager.prototype) as any; let base = 0;
  am.atlases = [...r.atlases.values()].sort((a, b) => a.id - b.id).map((a) => { const x = { key: a.key, id: a.id, source: { url: a.key }, base, count: a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns }; base += x.count; return x; });
  am.sprites = []; for (const s of r.allSprites()) am.sprites[s.id] = { atlasIdx: am.atlases.findIndex((x: any) => x.id === s.atlas.id), anchorX: s.anchor.x, anchorY: s.anchor.y, anims: s.animList, dirAt: s.animList.map(() => null), stateAnim: new Int16Array(8), damage: [] };
  return am as AtlasManager;
}
const out = () => ({ entry: 0, w: 0, h: 0, ax: 0, ay: 0, hasDamageFrames: false, flipX: false, sprite: -1, frame: -1, anim: "" }) as any;
const SIGNS = ["sign_wooden_post", "sign_hanging", "sign_wall_plaque", "sign_billboard", "sign_metal_road", "sign_arrow"];

describe("frame-select encoding", () => {
  it("round-trips anim indices and leaves plain frames alone", () => {
    expect(frameAnim(animFrameId(3))).toBe(3); expect(frameAnim(2)).toBe(-1); expect(animFrameId(0) & FRAME_ANIM).toBeTruthy();
    expect(frameIdForAnim(["idle", "idle_r1"], "idle_r1")).toBe(animFrameId(1)); expect(frameIdForAnim(["idle"], "nope")).toBe(0);
    expect([0, 1, 2, 3, 4].map(signFacingAnim)).toEqual(["idle", "idle_r1", "idle_r2", "idle_r3", "idle"]);
  });
});

describe("ADR-120 sign facings (WebGL2 resolve)", () => {
  const am = tables(reg);
  for (const key of SIGNS) it(`${key}: rot 0..3 -> idle / idle_r1..r3, distinct frames`, () => {
    const s = reg.sprite(reg.ids.sprites.id(key)); const names = s.animList.map((a) => a.name);
    const frames = [0, 1, 2, 3].map((rot) => { const o = out(); expect(am.resolve(s.id, -1, 0, 0, frameIdForAnim(names, signFacingAnim(rot)), o)).toBe(true); expect(o.anim).toBe(signFacingAnim(rot)); return o.frame; });
    expect(new Set(frames).size).toBe(4);
    const o = out(); am.resolve(s.id, -1, 0, 0, 0, o); expect(o.frame).toBe(frames[0]); // plain frameId 0 unchanged
  });
});

describe("ADR-119 road autotiles", () => {
  it("road_<surface> and _m0.._m15 exist for every surface in the resident nature_roads atlas", () => {
    for (const surf of ["path", "gravel", "paved"]) for (const k of [`road_${surf}`, ...Array.from({ length: 16 }, (_, m) => `road_${surf}_m${m}`)]) {
      const s = reg.sprite(reg.ids.sprites.id(k)); expect(s.atlas.key).toBe("nature_roads");
    }
  });
  it("Canvas2D sorts Flat decals under every upright sprite", () => {
    expect(flatSortDepth(500, true)).toBeLessThan(flatSortDepth(-500, false));
    expect(flatSortDepth(1, true)).toBeLessThan(flatSortDepth(2, true));
  });
});
