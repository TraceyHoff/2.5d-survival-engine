import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, mergeManifests, type AssetRegistry } from "@engine/assets";
import { PACK_DIR } from "@engine/assets/node";
import { AnimState } from "@engine/core";
import { AtlasManager, bodyAtlasKeys, legacyDirFrameAtlases, wearableOnlyAtlases, newResolved } from "../src/assets/atlasManager.js";

/**
 * Multi-page dirFrames for non-vehicle sprites (ADR-107 swim/punch): the paper-doll body, its wear layers and animals
 * keep their legacy page for the old anims and put swim (AnimState 14) / punch (15) on an extra page through the
 * existing per-anim `dirFrames` schema (no schema change). Page geometry comes from each page's atlas entry.
 */
const json = (p: string) => JSON.parse(readFileSync(PACK_DIR + p, "utf8"));
const D = 8, SWIM = 6, PUNCH = 4;
/** dirFrames for an anim of `n` frames x 8 facings laid out row-major on `atlas` from cell `at` (rig.py order: facing-major). */
const df = (atlas: string, at: number, n: number) => { const out = []; for (let i = 0; i < n; i++) for (let d = 0; d < D; d++) out.push({ atlas, frame: at + d * n + i, anchor: { x: 0.5, y: 0.9 } }); return out; };

/** Customization pack with an extra swim+punch page on body_male and on one wearable (frame-aligned with the body). */
function multiPage(opts: { wearSwim: boolean } = { wearSwim: true }): { reg: AssetRegistry; cz: any; wearKey: string } {
  const cz = json("customization/manifest.customization.json");
  const body = cz.sprites.find((s: any) => s.key === "body_male"); const bat = cz.atlases.find((a: any) => a.key === body.atlas);
  // 80 extra frames (6 swim + 4 punch, x 8 facings) on a 10x8 page of the body's cell size: 440x480, not a bigger body page
  cz.atlases.push({ key: "body_male_p1", image: "atlases/body_male_p1.png", frameW: bat.frameW, frameH: bat.frameH, columns: 10, rows: 8 });
  body.animations.swim = { frames: [0, 1, 2, 3, 4, 5], fps: 6, directions: 8, loop: true, dirFrames: df("body_male_p1", 0, SWIM) };
  body.animations.punch = { frames: [0, 1, 2, 3], fps: 10, directions: 8, loop: false, dirFrames: df("body_male_p1", SWIM * D, PUNCH) };
  const w = cz.wearables.find((x: any) => x.key === "top_tee"); const wearKey = w.layers[0].bodies.male.sprite;
  const ws = cz.sprites.find((s: any) => s.key === wearKey); const wat = cz.atlases.find((a: any) => a.key === ws.atlas);
  if (opts.wearSwim) {
    cz.atlases.push({ key: `${wat.key}_p1`, image: `atlases/${wat.key}_p1.png`, frameW: wat.frameW, frameH: wat.frameH, columns: 10, rows: 8 });
    ws.animations.swim = { frames: [0, 1, 2, 3, 4, 5], fps: 6, directions: 8, loop: true, dirFrames: df(`${wat.key}_p1`, 0, SWIM) };
    ws.animations.punch = { frames: [0, 1, 2, 3], fps: 10, directions: 8, loop: false, dirFrames: df(`${wat.key}_p1`, SWIM * D, PUNCH) };
  }
  const merged = mergeManifests([{ name: "pack", manifest: json("manifest.json") }, { name: "customization", manifest: cz }] as never).manifest;
  return { reg: loadManifest(merged).registry, cz, wearKey };
}
/** AtlasManager without GL: sprite/atlas tables + stateAnim like rebuild() fills them. */
function tables(reg: AssetRegistry, lazy: (key: string) => boolean): AtlasManager {
  const am = Object.create(AtlasManager.prototype) as any; let base = 0;
  am.usedMark = new Uint8Array(4096); am.recentlyUsed = new Set(); am.vram = { misses: 0 }; am.pools = [{ cls: "wear", lru: { touch: () => true }, k: 1 }]; am.wearablesOn = true; am.queue = []; am.frame = 0;
  am.atlases = [...reg.atlases.values()].sort((a, b) => a.id - b.id).map((a) => { const r = { key: a.key, id: a.id, source: { url: a.key }, base, count: a.columns * a.rows, fw: a.frameW, fh: a.frameH, cols: a.columns, ...(lazy(a.key) ? { lazy: { w1: a.columns * a.frameW, h1: a.rows * a.frameH, state: 0, pool: 0 } } : {}) }; base += r.count; return r; });
  am.sprites = []; for (const s of reg.allSprites()) { const stateAnim = new Int16Array(16).fill(0);
    am.sprites[s.id] = { atlasIdx: am.atlases.findIndex((x: any) => x.id === s.atlas.id), anchorX: s.anchor.x, anchorY: s.anchor.y, anims: s.animList, dirAt: s.animList.map((an) => an.dirFrames ? Int32Array.from(an.dirFrames, (d) => am.atlases.findIndex((x: any) => x.id === d.atlas.id)) : null), stateAnim, damage: [] };
    // STATE_ANIMS lookup as rebuild() does it
    const names = s.animList.map((a) => a.name); const chain: Record<number, string[]> = { [AnimState.Idle]: ["idle"], [AnimState.Walk]: ["walk"], [AnimState.Attack]: ["attack"], [AnimState.Swim]: ["swim", "walk", "idle"], [AnimState.Punch]: ["punch", "attack", "idle"] };
    for (const [st, c] of Object.entries(chain)) { const i = c.map((n) => names.indexOf(n)).find((x) => x >= 0); stateAnim[+st] = i ?? 0; } }
  return am as AtlasManager;
}
const idOf = (reg: AssetRegistry, key: string) => [...reg.allSprites()].find((s) => s.key === key)!.id;

describe("multi-page dirFrames for bodies, wear and animals (ADR-107 swim/punch)", () => {
  it("the extra pages validate with today's schema (backward compatible: no new fields)", () => {
    // loadManifest throws ManifestError on any validator issue (dirFrames length, page, frame range, anchors)
    expect(() => multiPage()).not.toThrow(); expect(() => multiPage({ wearSwim: false })).not.toThrow();
    expect(multiPage().reg.atlases.get("body_male_p1")?.columns).toBe(10);
  });
  it("a partly split sprite keeps its first page (only fully facing-split vehicles have a legacy page)", () => {
    const { reg } = multiPage(); const legacy = legacyDirFrameAtlases(reg);
    expect(legacy.has("body_male")).toBe(false); expect(legacy.has("body_male_p1")).toBe(false);
    for (const k of legacy) expect(k).toMatch(/^veh_/);
  });
  it("body pages are found by use, not by key: the swim/punch page joins the body pool", () => {
    const { reg } = multiPage(); const b = bodyAtlasKeys(reg);
    expect(b.has("body_male")).toBe(true); expect(b.has("body_male_p1")).toBe(true); expect(b.has("body_female")).toBe(true);
  });
  it("a wearable's extra page streams through the wear pool like its first page", () => {
    const { reg, wearKey } = multiPage(); const lazy = wearableOnlyAtlases(reg); const s = [...reg.allSprites()].find((x) => x.key === wearKey)!;
    expect(lazy.has(s.atlas.key)).toBe(true); expect(lazy.has(`${s.atlas.key}_p1`)).toBe(true); expect(lazy.has("body_male_p1")).toBe(false);
  });
  it("resolve() reads swim/punch from the extra page, frame-aligned between body and wear for every facing and time", () => {
    const { reg, wearKey } = multiPage(); const lazy = wearableOnlyAtlases(reg); const am = tables(reg, (k) => lazy.has(k));
    const body = idOf(reg, "body_male"), wear = idOf(reg, wearKey); const rb = newResolved(), rw = newResolved();
    const atl = (i: number) => (am as any).atlases[i].key as string;
    for (const st of [AnimState.Swim, AnimState.Punch]) for (let f = 0; f < 8; f++) for (const t of [0, 0.2, 0.45, 0.9]) {
      const bi = am.sharedStateAnim(body, [{ sprite: body }, { sprite: wear }], st); expect(am.animName(body, bi)).toBe(st === AnimState.Swim ? "swim" : "punch");
      expect(am.resolve(body, bi, f * Math.PI / 4, t, 0, rb)).toBe(true); expect(am.resolve(wear, am.findAnim(wear, rb.anim), f * Math.PI / 4, t, 0, rw)).toBe(true);
      expect(atl(rb.atlas)).toBe("body_male_p1"); expect(atl(rw.atlas)).toMatch(/_p1$/);
      expect(rw.frame).toBe(rb.frame); // same cell on both pages = same frame x facing
    }
    // old anims stay on the first page
    expect(am.resolve(body, am.findAnim(body, "walk"), 0, 0.1, 0, rb)).toBe(true); expect(atl(rb.atlas)).toBe("body_male");
  });
  it("a wearable without swim/punch drops the whole doll to the next shared anim (walk + clip-and-bob, attack)", () => {
    const { reg, wearKey } = multiPage({ wearSwim: false }); const am = tables(reg, () => false);
    const body = idOf(reg, "body_male"), wear = idOf(reg, wearKey);
    expect(am.animName(body, am.sharedStateAnim(body, [{ sprite: wear }], AnimState.Swim))).toBe("walk");
    expect(am.animName(body, am.sharedStateAnim(body, [{ sprite: wear }], AnimState.Punch))).toBe("attack");
    // body alone (or with expression layers that have none of the chain) keeps its own swim
    expect(am.animName(body, am.sharedStateAnim(body, [], AnimState.Swim))).toBe("swim");
  });
  it("sprites without swim/punch fall back as before (swim -> walk, punch -> attack)", () => {
    const reg = loadManifest(json("customization/manifest.customization.json")).registry; const am = tables(reg, () => false); const b = idOf(reg, "body_female");
    expect(am.animName(b, am.sharedStateAnim(b, [], AnimState.Swim))).toBe("walk"); expect(am.animName(b, am.sharedStateAnim(b, [], AnimState.Punch))).toBe("attack");
  });
  it("pageReadyAt() streams the page the frame lives on, not the sprite's first page", () => {
    const { reg, wearKey } = multiPage(); const lazy = wearableOnlyAtlases(reg); const am = tables(reg, (k) => lazy.has(k)) as any;
    const wear = idOf(reg, wearKey); const r = newResolved(); am.resolve(wear, am.findAnim(wear, "swim"), 0, 0, 0, r);
    const req: string[] = []; am.request = (a: any) => req.push(a.key);
    expect(am.pageReadyAt(r.atlas, 0)).toBe(false); expect(req).toEqual([`${am.atlases[am.sprites[wear].atlasIdx].key}_p1`]);
    am.atlases[r.atlas].lazy.state = 2; expect(am.pageReadyAt(r.atlas, 0)).toBe(true);
  });
  it("pool slot math holds with mixed page sizes: 16-aligned pitch, slot = largest page, at 1x and @2x", () => {
    const am = Object.create(AtlasManager.prototype) as any; am.layerSize = 2048;
    const pages = (dims: [number, number][]) => dims.map(([w1, h1]) => ({ lazy: { w1, h1 } }));
    for (const [dims, k, per] of [[[[880, 840], [440, 480]], 2, 1], [[[880, 840], [440, 480]], 1, 4], [[[968, 960]], 2, 1], [[[41 * 24, 55 * 12], [410, 440]], 1, 6]] as const) {
      const g = am.poolGeom(pages(dims as never), k);
      expect(g.pw % 16).toBe(0); expect(g.ph % 16).toBe(0); expect(g.sw % 4).toBe(0); expect(g.sh % 4).toBe(0);
      expect(g.sw).toBeGreaterThanOrEqual(Math.max(...dims.map((d) => d[0])) * k); expect(g.perLayer).toBe(per);
    }
  });
  it("animals: a swim page beside an oversized sheet (boar/wolf/deer @2x > 2048) resolves per anim", () => {
    const m = json("manifest.json"); const boar = m.sprites.find((s: any) => /boar/.test(s.key)); const at = m.atlases.find((a: any) => a.key === boar.atlas);
    m.atlases.push({ key: `${at.key}_swim`, image: `atlases/${at.key}_swim.png`, frameW: at.frameW, frameH: at.frameH, columns: 8, rows: 6 });
    boar.animations.swim = { frames: [0, 1, 2, 3, 4, 5], fps: 6, directions: 8, loop: true, dirFrames: df(`${at.key}_swim`, 0, SWIM) };
    const reg = loadManifest(m).registry; const am = tables(reg, () => false) as any; const id = idOf(reg, boar.key); const r = newResolved();
    expect(legacyDirFrameAtlases(reg).has(at.key)).toBe(false);
    expect(am.resolve(id, am.sharedStateAnim(id, [], AnimState.Swim), 1, 0.3, 0, r)).toBe(true); expect(am.atlases[r.atlas].key).toBe(`${at.key}_swim`);
    expect(am.resolve(id, am.findAnim(id, Object.keys(boar.animations)[0]), 1, 0.3, 0, r)).toBe(true); expect(am.atlases[r.atlas].key).toBe(at.key);
  });
});
