import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AssetRegistry, loadManifest, mergeManifests } from "@engine/assets";
import { PACK_DIR } from "@engine/assets/node";
import { AtlasManager, addDirFrameRects, dirFrameIndex, newResolved } from "../src/assets/atlasManager.js";

/** Explicit per-frame (page, rect) dirFrames for any anim (body + wear), duplicates shared; arithmetic stays the fallback. */
const json = (p: string) => JSON.parse(readFileSync(PACK_DIR + p, "utf8"));
const D = 8;
// "wave": 3 frames x 8 facings; frame 2 reuses frame 0's rect (a held pose), and facings 4..7 reuse facings 0..3 (shared rects)
const rectFor = (i: number, d: number) => { const fi = i === 2 ? 0 : i, dd = d % 4; return { x: fi * 64, y: dd * 96, w: 60 + fi, h: 90 + dd }; };
const wave = (atlas: string) => { const out = []; for (let i = 0; i < 3; i++) for (let d = 0; d < D; d++) out.push({ atlas, rect: rectFor(i, d), anchor: { x: 0.5, y: 0.9 } }); return out; };

function pack(bad?: boolean): { reg: AssetRegistry; wearKey: string } {
  const cz = json("customization/manifest.customization.json");
  const body = cz.sprites.find((s: any) => s.key === "body_male");
  cz.atlases.push({ key: "body_male_px", image: "atlases/body_male_px.png", frameW: 64, frameH: 96, columns: 4, rows: 4 });
  body.animations.wave = { frames: [0, 1, 2], fps: 6, directions: 8, loop: true, dirFrames: wave("body_male_px") };
  if (bad) body.animations.wave.dirFrames[3].rect = { x: 250, y: 0, w: 20, h: 10 };
  const w = cz.wearables.find((x: any) => x.key === "top_tee"); const wearKey = w.layers[0].bodies.male.sprite;
  const ws = cz.sprites.find((s: any) => s.key === wearKey);
  cz.atlases.push({ key: "wear_px", image: "atlases/wear_px.png", frameW: 64, frameH: 96, columns: 4, rows: 4 });
  ws.animations.wave = { frames: [0, 1, 2], fps: 6, directions: 8, loop: true, dirFrames: wave("wear_px") };
  const merged = mergeManifests([{ name: "pack", manifest: json("manifest.json") }, { name: "customization", manifest: cz }] as never).manifest;
  return { reg: loadManifest(merged).registry, wearKey };
}
function tables(reg: AssetRegistry): any {
  const am = Object.create(AtlasManager.prototype) as any;
  am.usedMark = new Uint8Array(8192); am.recentlyUsed = new Set(); am.vram = { misses: 0 }; am.pools = []; am.wearablesOn = true; am.queue = []; am.frame = 0; am.layerSize = 2048;
  am.atlases = [...reg.atlases.values()].sort((a, b) => a.id - b.id).map((a) => ({ key: a.key, id: a.id, source: { url: a.key }, base: 0, count: a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns, scale: 1, px: 0, py: 0, layer: 0, masks: {}, emis: null }));
  addDirFrameRects(reg, am.atlases); let base = 0; for (const a of am.atlases) { a.base = base; base += a.count; } am.totalFrames = base;
  am.sprites = []; for (const s of reg.allSprites()) {
    const dirAt = s.animList.map((an) => an.dirFrames ? Int32Array.from(an.dirFrames, (d) => am.atlases.findIndex((x: any) => x.id === d.atlas.id)) : null);
    const dirF = s.animList.map((an, k) => an.dirFrames ? Int32Array.from(an.dirFrames, (d, j) => dirFrameIndex(am.atlases[dirAt[k]![j]!], d)) : null);
    am.sprites[s.id] = { atlasIdx: am.atlases.findIndex((x: any) => x.id === s.atlas.id), anchorX: s.anchor.x, anchorY: s.anchor.y, anims: s.animList, dirAt, dirF, stateAnim: new Int16Array(16), damage: [] };
  }
  return am;
}
const idOf = (reg: AssetRegistry, key: string) => [...reg.allSprites()].find((s) => s.key === key)!.id;
const animOf = (reg: AssetRegistry, id: number, name: string) => reg.sprite(id).animList.findIndex((a) => a.name === name);

describe("explicit per-frame (page, rect) dirFrames for every anim", () => {
  it("validates rects inside the page (frame optional), rejects one outside", () => {
    expect(() => pack()).not.toThrow(); expect(() => pack(true)).toThrow(/rect must be integer px inside the 256x384 page/);
  });
  it("identical rects share one frame-table entry; grid frames keep their arithmetic indices", () => {
    const { reg } = pack(); const am = tables(reg); const a = am.atlases.find((x: any) => x.key === "body_male_px");
    expect(a.extra.n0).toBe(16); expect(a.extra.rects.length).toBe(2 * 4); expect(a.count).toBe(16 + 8); // 2 distinct poses x 4 facings
    addDirFrameRects(reg, am.atlases); expect(a.count).toBe(24); // idempotent
  });
  it("resolve(): rect size + rect-relative anchor, held/mirrored frames hit the same entry, wear stays frame-aligned", () => {
    const { reg, wearKey } = pack(); const am = tables(reg); const b = idOf(reg, "body_male"), w = idOf(reg, wearKey);
    const ba = animOf(reg, b, "wave"), wa = animOf(reg, w, "wave"); const r0 = newResolved(), r2 = newResolved(), r6 = newResolved(), rw = newResolved();
    am.resolve(b, ba, 0, 0.01, 0, r0); am.resolve(b, ba, 0, 2.01 / 6, 0, r2);
    expect(r2.entry).toBe(r0.entry); expect(r0.w).toBe(60); expect(r0.h).toBe(90); expect(r0.ax).toBeCloseTo(30); expect(r0.ay).toBeCloseTo(81);
    const byPose = new Map<number, number>(); for (let f = 0; f < 8; f++) { am.resolve(b, ba, f, 0.01, 0, r6); const dd = AssetRegistry.directionIndex(f, 8) % 4; expect(r6.h).toBe(90 + dd); if (byPose.has(dd)) expect(r6.entry).toBe(byPose.get(dd)); else byPose.set(dd, r6.entry); }
    expect(byPose.size).toBe(4);
    for (const t of [0.01, 1.01 / 6, 2.01 / 6, 5.01 / 6]) for (let f = 0; f < 8; f++) {
      am.resolve(b, ba, f, t, 0, r0); am.resolve(w, wa, f, t, 0, rw);
      expect(rw.frame - am.atlases[rw.atlas].extra.n0).toBe(r0.frame - am.atlases[r0.atlas].extra.n0); expect([rw.w, rw.h, rw.ax, rw.ay]).toEqual([r0.w, r0.h, r0.ax, r0.ay]);
    }
    // arithmetic fallback untouched: walk resolves on the legacy page by frames[i] + dir * dirStride
    const wk = animOf(reg, b, "walk"); am.resolve(b, wk, 2, 0, 0, r0); const an = reg.sprite(b).animList[wk]!;
    expect(r0.atlas).toBe(am.sprites[b].atlasIdx); expect(r0.frame).toBe(an.frames[0]! + AssetRegistry.directionIndex(2, an.directions) * (an.directions > 1 ? an.dirStride : 0));
  });
  it("frame table rows of the extra entries carry the rect UVs; matches AssetRegistry.dirFrame()", () => {
    const { reg } = pack(); const am = tables(reg); const a = am.atlases.find((x: any) => x.key === "body_male_px");
    const data = new Float32Array(Math.ceil(am.totalFrames) * 8 + 8); am.markTable = () => {}; am.writeFrames(a, data, new Map());
    const e = a.extra.byKey.get("64,96,61,91"); const o = (a.base + e) * 8; const S = 2048;
    expect([data[o]! * S, data[o + 1]! * S, data[o + 2]! * S, data[o + 3]! * S, data[o + 4], data[o + 5]]).toEqual([64, 96, 125, 187, 61, 91]);
    const b = idOf(reg, "body_male"); const ref = reg.dirFrame(b, "wave", [0,1,2,3,4,5,6,7].find((f) => AssetRegistry.directionIndex(f, 8) === 1)!, 1.01 / 6);
    expect([ref.atlas.key, ref.x, ref.y, ref.w, ref.h]).toEqual(["body_male_px", 64, 96, 61, 91]); expect(ref.anchorX).toBeCloseTo(30.5);
  });
});
