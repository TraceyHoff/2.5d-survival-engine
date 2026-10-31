import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadManifest, ManifestError, type AssetRegistry } from "@engine/assets";
import { PACK_DIR } from "@engine/assets/node";
import { AtlasManager, STREAM_UNLOAD_FRAMES, STREAM_UPLOADS_PER_FRAME } from "../src/assets/atlasManager.js";
import { PageLRU, PRIO_NEAR } from "../src/gl/vram.js";
import { pieceDrawSprite } from "../src/sprites.js";

const json = (p: string) => JSON.parse(readFileSync(PACK_DIR + p, "utf8"));
const img = (k: string) => ({ key: k, image: `atlases/${k}.png`, frameW: 32, frameH: 32, columns: 4, rows: 4 });
const spr = (key: string, atlas: string, extra: object = {}) => ({ key, category: "resource", atlas, animations: { idle: { frames: [0], fps: 1 } }, ...extra });
/** Base pack + a resident nature_placeholder sheet + N stream sheets (crop sprite each; one sprite overrides to null). */
function pack(n = 4, mod?: (m: any) => void): { m: any; reg: AssetRegistry } {
  const m = json("manifest.json");
  m.atlases.push(img("nature_placeholder")); m.sprites.push(spr("ph_sprout", "nature_placeholder"), spr("ph_sapling", "nature_placeholder"));
  for (let i = 0; i < n; i++) { m.atlases.push({ ...img(`crop_t${i}`), residency: "stream", placeholder: "ph_sprout" }); m.sprites.push(spr(`crop_t${i}_a`, `crop_t${i}`)); }
  m.sprites.push(spr("sapling_t", "crop_t0", { placeholder: "ph_sapling" }), spr("clutter_t", "crop_t1", { placeholder: null }));
  mod?.(m); return { m, reg: loadManifest(m).registry };
}
const id = (reg: AssetRegistry, k: string) => reg.ids.sprites.id(k);
/** GL-free manager with the stream sheets in a stream pool of `slots` (page-in stubbed: resolves next microtask). */
function mgr(reg: AssetRegistry, slots = 3): any {
  const am = Object.create(AtlasManager.prototype) as any; let base = 0;
  const lru = new PageLRU<string>(slots, 90);
  am.registry = reg; am.frame = 1; am.gen = 0; am.inflight = 0; am.queue = []; am.wearablesOn = true; am.placeholderCache = new Map(); am.streamStarts = 0;
  am.vram = { misses: 0, pending: 0, pageIn() {}, evict() { am.evicted = (am.evicted ?? 0) + 1; } }; am.table = new Float32Array(0); am.tintRowMap = new Map(); am.writeFrames = () => {};
  am.pools = [{ cls: "stream", lru, slotBytes: 1, k: 1 }];
  am.atlases = [...reg.atlases.values()].sort((a, b) => a.id - b.id).map((a) => { const r = { key: a.key, id: a.id, source: { url: a.key }, base, count: 16, fw: 32, fh: 32, cols: 4, ...(a.residency === "stream" ? { lazy: { w1: 128, h1: 128, state: 0, pool: 0 } } : {}) }; base += 16; return r; });
  am.sprites = []; for (const s of reg.allSprites()) am.sprites[s.id] = { atlasIdx: am.atlases.findIndex((x: any) => x.id === s.atlas.id), anchorX: 0.5, anchorY: 0.9, anims: s.animList, dirAt: s.animList.map(() => null), stateAnim: new Int16Array(16), damage: [] };
  am.started = [] as string[];
  am.pageIn = async (a: any) => { am.started.push(a.key); lru.allocate(a.key, am.frame, a.lazy.prio); a.lazy.state = 2; };
  return am;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("manifest residency + placeholder (schema, backward compatible)", () => {
  it("the shipped packs load unchanged (no residency = resident)", () => {
    const reg = loadManifest(json("manifest.json")).registry; const opt = (k: string) => /^season_/.test(k); // seasonal twin sheets opt in to streaming; gt_ ground pages are resident (ADR-246 follow-up)
    expect([...reg.atlases.values()].every((a) => opt(a.key) ? a.residency === "stream" : a.residency === undefined)).toBe(true);
    expect([...reg.atlases.values()].filter((a) => a.key.startsWith("gt_")).length).toBeGreaterThan(0);
    const { reg: r2 } = pack(); expect(r2.atlases.get("crop_t0")!.residency).toBe("stream"); expect(r2.atlases.get("crop_t0")!.placeholder).toBe("ph_sprout");
    expect(r2.sprite(id(r2, "clutter_t")).placeholder).toBeNull(); expect(r2.sprite(id(r2, "sapling_t")).placeholder).toBe("ph_sapling");
  });
  it("validator: residency value, placeholder must be a known sprite on a resident atlas", () => {
    const bad = (mod: (m: any) => void, re: RegExp) => { try { pack(2, mod); throw new Error("accepted"); } catch (e) { expect(e).toBeInstanceOf(ManifestError); expect(String((e as ManifestError).message ?? e) + JSON.stringify((e as any).issues ?? [])).toMatch(re); } };
    bad((m) => { m.atlases.find((a: any) => a.key === "crop_t0").residency = "lazy"; }, /residency/);
    bad((m) => { m.atlases.find((a: any) => a.key === "crop_t0").placeholder = "nope"; }, /unknown placeholder/);
    bad((m) => { m.atlases.find((a: any) => a.key === "crop_t0").placeholder = "crop_t1_a"; }, /resident atlas/);
    bad((m) => { m.sprites.find((s: any) => s.key === "sapling_t").placeholder = 3; }, /placeholder must be/);
  });
});

describe("stream pool: placeholders, near-view load/keep, upload budget, idle unload, ladder", () => {
  it("placeholderOf: sprite override > atlas placeholder; null / unknown = nothing", () => {
    const { reg } = pack(); const am = mgr(reg);
    expect(am.placeholderOf(id(reg, "crop_t2_a"))).toBe(id(reg, "ph_sprout"));
    expect(am.placeholderOf(id(reg, "sapling_t"))).toBe(id(reg, "ph_sapling"));
    expect(am.placeholderOf(id(reg, "clutter_t"))).toBe(-1);
    expect(am.isStreamSprite(id(reg, "crop_t0_a"))).toBe(true); expect(am.isStreamSprite(id(reg, "ph_sprout"))).toBe(false);
  });
  it("loads inside the load radius only, at most STREAM_UPLOADS_PER_FRAME starts per frame; resident pages draw", async () => {
    const { reg } = pack(6); const am = mgr(reg, 8); const crops = [0, 1, 2, 3, 4, 5].map((i) => id(reg, `crop_t${i}_a`));
    am.streamNear(crops[0], false, 4); await flush(); expect(am.started).toEqual([]); // keep radius never requests
    for (const c of crops) am.streamNear(c, true, 4); await flush();
    expect(am.started.length).toBe(STREAM_UPLOADS_PER_FRAME);
    for (let f = 0; f < 4; f++) { am.beginFrame(); await flush(); }
    expect(am.started.length).toBe(6);
    const ia = am.sprites[crops[0]!].atlasIdx; expect(am.streamPageReady(ia, 4)).toBe(true);
    expect(am.streamPageReady(am.sprites[id(reg, "ph_sprout")].atlasIdx)).toBe(true); // resident: always ready, no miss
  });
  it("hysteresis: a page touched inside the keep radius stays; off-screen for STREAM_UNLOAD_FRAMES it is dropped", async () => {
    const { reg } = pack(2); const am = mgr(reg); const a = id(reg, "crop_t0_a"), b = id(reg, "crop_t1_a");
    am.streamNear(a, true, 4); am.streamNear(b, true, 4); await flush();
    for (let f = 0; f < STREAM_UNLOAD_FRAMES + 40; f++) { am.streamNear(a, false, 4); am.beginFrame(); }
    expect(am.atlases[am.sprites[a].atlasIdx].lazy.state).toBe(2); expect(am.atlases[am.sprites[b].atlasIdx].lazy.state).toBe(0); expect(am.evicted).toBe(1);
    expect(am.streamPageReady(am.sprites[b].atlasIdx, 4)).toBe(false); // back in view: miss + re-request
    await flush(); expect(am.atlases[am.sprites[b].atlasIdx].lazy.state).toBe(2);
  });
  it("full pool: a nearer sheet evicts a farther idle one; fallback ladder (wearables off) stops far stream loads", async () => {
    const { reg } = pack(4); const am = mgr(reg, 2); const c = [0, 1, 2, 3].map((i) => id(reg, `crop_t${i}_a`));
    am.streamNear(c[0], true, 400); am.streamNear(c[1], true, 400); await flush();
    for (let f = 0; f < 100; f++) am.beginFrame();
    am.streamNear(c[2], true, 4); await flush(); expect(am.pools[0].lru.size).toBe(2); expect(am.pools[0].lru.has("crop_t2")).toBe(true);
    am.wearablesOn = false; am.streamNear(c[3], true, 400); await flush(); expect(am.started).not.toContain("crop_t3");
    am.streamNear(c[3], true, PRIO_NEAR); await flush(); expect(am.started).toContain("crop_t3");
  });
});

describe("ADR-232: build pieces on stream sheets (decor rugs / vases) request their page", () => {
  it("pieceDrawSprite requests a missing stream page, draws the placeholder (or nothing) meanwhile, then the real art", async () => {
    const { reg } = pack(3); const am = mgr(reg); const rug = id(reg, "crop_t0_a"), vase = id(reg, "clutter_t");
    expect(pieceDrawSprite(am, rug)).toBe(id(reg, "ph_sprout")); // was: drawn from a never-requested page = invisible forever
    expect(pieceDrawSprite(am, vase)).toBe(-1); // placeholder null: skipped until resident
    expect(am.started).toEqual(["crop_t0", "crop_t1"]);
    await flush(); am.beginFrame();
    expect(pieceDrawSprite(am, rug)).toBe(rug); expect(pieceDrawSprite(am, vase)).toBe(vase);
    expect(pieceDrawSprite(am, id(reg, "ph_sprout"))).toBe(id(reg, "ph_sprout")); // resident art: unchanged, no request
    expect(am.started.length).toBe(2);
  });
  it("stays requested with wearables/stream ladder off (near priority)", async () => {
    const { reg } = pack(2); const am = mgr(reg); am.wearablesOn = false; const rug = id(reg, "crop_t0_a");
    pieceDrawSprite(am, rug); await flush(); expect(am.started).toEqual(["crop_t0"]); expect(pieceDrawSprite(am, rug)).toBe(rug);
  });
});
