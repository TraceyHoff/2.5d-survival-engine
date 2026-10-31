import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { AssetRegistry, loadManifest, mergeManifests, type ManifestJson } from "../src/index.js";
import { PACK_DIR, imageSizeOf, readManifestJson } from "../src/node.js";
import { MANIFEST_INDEX } from "../../../apps/client/src/manifest-index.js";

// Player v2 SAMPLE (assets/customization/tools/v2_sample.py; spec player_v2_spec.md): an isolated test fragment that sits
// NEXT TO the v1 character art. It must load and merge with the shipped customization pack without a single key
// collision, never replace v1 keys, keep only the core group resident (in the ADR-220 body/wear pools; everything else
// streams) and carry the v2 frame contract: 48x80 / @2x 96x160 frames pivoted at (24,74), 8 facings, v1 frame counts/fps
// for the core anims + the full v2 set (spec §6), one atlas per anim group (every @2x page <= 2048), body frameMeta
// head/handR/handL/back/hip/footL/footR (+ carry / seat sockets), hand angles in DEGREES (as v1 / handOf), every layer
// keyed v2s_<exact v1 part key> of the sample appearance, and the sleep_lie / sleep_lie_under bed sets (4 rotations).
const DIR = PACK_DIR + "customization_v2_sample/";
const FILE = DIR + "manifest.customization_v2_sample.json";
const sample = () => JSON.parse(readFileSync(FILE, "utf8")) as { atlases: any[]; sprites: any[]; [k: string]: any };
const side = JSON.parse(readFileSync(DIR + "sample.v2.json", "utf8")) as { layers: { sprite: string; slot: string; layer: number; tintChannels: number }[] };
const cz = () => readManifestJson<ManifestJson>(PACK_DIR + "customization/manifest.customization.json");
const pack = () => JSON.parse(readFileSync(PACK_DIR + "manifest.json", "utf8")) as ManifestJson;
const ANIMS: Record<string, readonly [number, number, boolean]> = {   // frames / fps / loop (spec §6; idle/walk/attack/sit = v1)
  idle: [4, 4, true], walk: [6, 10, true], attack: [4, 12, false],
  block: [3, 10, false], attack_unarmed: [5, 14, false], attack_blade: [4, 14, false], attack_blunt: [5, 10, false], attack_axe: [5, 11, false],
  attack_spear: [4, 11, false], attack_throw: [4, 12, false],
  bow_draw: [4, 10, false], bow_hold: [2, 4, true], bow_release: [3, 12, false], attack_crossbow: [3, 12, false], gun_aim: [2, 4, true], gun_fire: [3, 15, false],
  crouch_idle: [4, 4, true], crouch_walk: [6, 8, true], carry_idle: [4, 4, true], carry_walk: [6, 9, true], sleep: [4, 2, true], sit: [4, 4, true],
  vehicle: [4, 6, true], build: [6, 12, true],
};
const GROUP_OF = (an: string) => (["idle", "walk", "attack"].includes(an) ? "" : ["bow_draw", "bow_hold", "bow_release", "attack_crossbow", "gun_aim", "gun_fire"].includes(an) ? "__ranged"
  : an === "block" || an.startsWith("attack_") ? "__combat" : "__pose");
const PX2_MIB = 185;    // whole sample, every group at @2x (colour + tintmask RGBA8)
const CORE_MIB = 32;    // resident core group only (@2x + 1x colour + tintmask RGBA8, lossless upper bound: measured 30.4)
const SPRITES = ["v2s_body_male", "v2s_cz_bottom_cargo_male", "v2s_cz_shoes_boots_male", "v2s_cz_top_henley_male", "v2s_cz_top_henley_male_sleeves",
  "v2s_cz_face_smile_male", "v2s_cz_eyes_round_male", "v2s_cz_hair_buzz_male", "v2s_cz_hair_buzz_male_hathair", "v2s_cz_hat_cap_male",
  "v2s_body_male_armfront", "v2s_cz_top_henley_male_armfront"];
// every v2s_ layer twin of a v1 part = "v2s_" + the exact v1 sprite key the sample appearance resolves to
const V1_TWINS = SPRITES.filter((k) => !k.endsWith("_armfront")).map((k) => k.slice(4));
// every worn layer lies flat (ADR-244): all sample layers but the armfront overlays (tooling only) have the bed set
const SLEEP = ["v2s_body_male", "v2s_cz_bottom_cargo_male", "v2s_cz_shoes_boots_male", "v2s_cz_top_henley_male", "v2s_cz_face_smile_male", "v2s_cz_eyes_round_male", "v2s_cz_hair_buzz_male",
  "v2s_cz_top_henley_male_sleeves", "v2s_cz_hair_buzz_male_hathair", "v2s_cz_hat_cap_male"];
const SLEEP_ANIMS = ["sleep_lie", "sleep_lie_under"];

describe("customization_v2_sample (player v2 test fragment)", () => {
  it("only new v2s_ keys, merges with pack + customization without collisions and loads", () => {
    const s = sample(); const v1 = cz();
    expect(s.sprites.map((x) => x.key).sort(), "exact keys only (ADR-240 scrap aliases dropped)").toEqual([...SPRITES].sort());
    expect((side as any).compatAliases).toBeUndefined();
    for (const k of [...s.sprites, ...s.atlases].map((x) => x.key)) expect(k).toMatch(/^v2s_/);
    expect((s as any).wearables ?? [], "no wearables: creator UI, ids.lock and saves untouched").toEqual([]);
    expect((s as any).bodyTypes, "no bodyTypes").toBeUndefined();
    const v1keys = new Set([...(v1.sprites as any[]), ...(v1.atlases as any[])].map((x) => x.key));
    for (const x of [...s.sprites, ...s.atlases]) expect(v1keys.has(x.key), x.key).toBe(false);
    const m = mergeManifests([{ name: "pack", manifest: pack() }, { name: "customization", manifest: v1 }, { name: "customization_v2_sample", manifest: s }] as never);
    expect(m.collisions).toEqual([]);
    const { registry: r } = loadManifest(m.manifest);
    for (const k of SPRITES) expect(r.id(k), k).toBeGreaterThanOrEqual(0);
    expect(r.id("body_male")).toBeGreaterThanOrEqual(0);   // v1 art still there
    expect(loadManifest(s).registry.id("v2s_body_male")).toBeGreaterThanOrEqual(0);   // and the fragment loads on its own
  });

  it("every layer is v2s_<exact v1 part key> of the sample appearance (uncovered + hathair hair)", () => {
    const v1 = new Set((cz().sprites as any[]).map((x) => x.key));
    for (const k of V1_TWINS) expect(v1.has(k), `v1 sprite ${k}`).toBe(true);
    const sd = side as any;
    expect(sd.appearance).toEqual({ bodyType: "male", top: "top_henley", bottom: "bottom_cargo", shoes: "shoes_boots", hat: "hat_cap", hair: "hair_buzz", face: "face_smile", eyes: "eyes_round" });
    for (const l of sd.layers) if (l.v1Sprite) expect(l.sprite).toBe("v2s_" + l.v1Sprite);
    const hair = sd.layers.filter((l: any) => l.slot === "hair").map((l: any) => [l.sprite, l.variant]);
    expect(hair).toEqual([["v2s_cz_hair_buzz_male", "uncovered"], ["v2s_cz_hair_buzz_male_hathair", "hatHair"]]);
  });

  it("is not served by default (isolated); core group resident in the body/wear pools, the rest streams; shard far under 20 MiB", () => {
    expect(MANIFEST_INDEX.some((f) => f.url.includes("customization_v2_sample"))).toBe(false);
    let core = 0;
    for (const a of sample().atlases) {
      const isCore = !a.key.includes("__");
      expect(a.residency, a.key).toBe(isCore ? "resident" : "stream");
      if (isCore) { expect(a.pool, a.key).toBe(a.key.startsWith("v2s_wr_body_") ? "body" : "wear"); const s1 = imageSizeOf(DIR + a.image)!; core += s1.w * s1.h * 5; }
      else expect(a.pool, a.key).toBeUndefined();
    }
    expect((core * 4 * 2) / 2 ** 20, "resident core: (1x + @2x) colour + tintmask RGBA8 MiB").toBeLessThan(CORE_MIB);
    expect(statSync(FILE).size).toBeLessThan(4 * 1024 * 1024);
    let px2 = 0;
    for (const a of sample().atlases) {
      for (const p of [a.image, a.masks.tintmask, a.pages[0].image, a.masks.tintmask.replace(/\.png$/, "@2x.png"), a.ktx2, a.pages[0].ktx2, a.masksKtx2.tintmask, a.pages[0].masksKtx2.tintmask]) expect(existsSync(DIR + p), p).toBe(true);
      const s1 = imageSizeOf(DIR + a.image)!, s2 = imageSizeOf(DIR + a.pages[0].image)!;
      expect([s1.w, s1.h]).toEqual([a.frameW, a.frameH]); expect([s2.w, s2.h]).toEqual([a.frameW * 2, a.frameH * 2]);
      expect(Math.max(s2.w, s2.h), `${a.key} @2x page`).toBeLessThanOrEqual(2048);
      px2 += s2.w * s2.h;
    }
    expect((px2 * 4 * 2) / 2 ** 20, "@2x colour + tintmask RGBA8 MiB (all groups)").toBeLessThan(PX2_MIB);
  });

  it("8 facings x the full v2 anim set; group atlases; rects in page, trimmed from 48x80 frames", () => {
    const s = sample(); const at = new Map(s.atlases.map((a) => [a.key, a]));
    for (const sp of s.sprites) { expect(Object.keys(sp.animations).sort(), sp.key).toEqual([...Object.keys(ANIMS), ...(SLEEP.includes(sp.key) ? SLEEP_ANIMS : [])].sort()); for (const [an, [n, fps, loop]] of Object.entries(ANIMS)) {
      const a = sp.animations[an]; expect(a, `${sp.key}.${an}`).toBeDefined();
      for (const e of a.dirFrames) expect(e.atlas, `${sp.key}.${an}`).toBe(sp.atlas + GROUP_OF(an));
      expect([a.frames.length, a.fps, a.loop, a.directions, a.dirStride, a.dirFrames.length]).toEqual([n, fps, loop, 8, n, n * 8]);
      for (const e of a.dirFrames) { const A = at.get(e.atlas)!; const { x, y, w, h } = e.rect;
        expect(x + w <= A.frameW && y + h <= A.frameH && w > 0 && h > 0, `${sp.key}.${an}`).toBe(true);
        for (const v of [e.anchor.x, e.anchor.y]) { expect(v).toBeGreaterThanOrEqual(-8); expect(v).toBeLessThanOrEqual(9); }   // pivot near the rect (loader rule)
        expect(w).toBeLessThanOrEqual(48); expect(h).toBeLessThanOrEqual(80);   // trimmed from a 48x80 frame
      }
    } }
    expect((side as any).anims.map((a: any) => [a.name, a.frames, a.fps, a.loop])).toEqual(Object.entries(ANIMS).map(([k, v]) => [k, ...v]));
  });

  it("sleep_lie / sleep_lie_under: 4 bed rotations x 4 frames, streamed sleep atlas, bed socket, rotation r = facing r*PI/2", () => {
    const s = sample(); const at = new Map(s.atlases.map((a) => [a.key, a])); const r = loadManifest(s).registry;
    for (const k of SLEEP) { const sp = s.sprites.find((x) => x.key === k)!;
      for (const an of SLEEP_ANIMS) { const a = sp.animations[an];
        expect([a.frames.length, a.fps, a.loop, a.directions, a.dirStride, a.dirFrames.length], `${k}.${an}`).toEqual([4, 2, true, 4, 4, 16]);
        for (const e of a.dirFrames) { expect(e.atlas).toBe(sp.atlas + "__sleep"); const A = at.get(e.atlas)!; expect(A.residency).toBe("stream");
          const { x, y, w, h } = e.rect; expect(x + w <= A.frameW && y + h <= A.frameH && w > 0 && h > 0).toBe(true);
          expect(w).toBeLessThanOrEqual(96); expect(h).toBeLessThanOrEqual(88);
          for (const v of [e.anchor.x, e.anchor.y]) { expect(v).toBeGreaterThanOrEqual(-8); expect(v).toBeLessThanOrEqual(9); } }
      } }
    for (const k of s.sprites.map((x) => x.key).filter((k) => !SLEEP.includes(k))) for (const an of SLEEP_ANIMS) expect(s.sprites.find((x) => x.key === k)!.animations[an], `${k} hidden in bed`).toBeUndefined();
    const id = r.id("v2s_body_male"); const body = s.sprites.find((x) => x.key === "v2s_body_male")!;
    for (const an of SLEEP_ANIMS) for (let rot = 0; rot < 4; rot++) {
      expect(AssetRegistry.directionIndex((rot * Math.PI) / 2, 4)).toBe(rot);
      const f = r.dirFrame(id, an, (rot * Math.PI) / 2, 0); for (const n of ["bed", "head", "pillow"]) expect(f.anchors?.[n], `${an} r${rot} ${n}`).toBeDefined();
      expect(body.animations[an].frameMeta[`df:${rot}`].anchors.bed).toEqual(f.anchors!.bed);
    }
    const sl = (side as any).sleepLie; expect(sl.directions).toBe(4); expect(sl.hairVariant).toMatch(/^uncovered/);
    for (const p of ["bed", "bed_double_*", "bunk_bed"]) expect(Object.values(sl.bedFits[p]).every((v: any) => v.length === 4), p).toBe(true);
    expect(sl.bedFits.bed.single.every((o: any) => o.x === 0 && o.y === 0)).toBe(true);
  });

  it("v1 accessory + hands sprites carry the same sleep set (v1 frames untouched, streamed cz_sleep_acc_* atlases)", () => {
    const v1 = cz() as any; const at = new Map((v1.atlases as any[]).map((a) => [a.key, a]));
    const worn = (v1.wearables as any[]).filter((w) => w.slot === "accessory" || w.slot === "hands");
    expect(worn.length).toBeGreaterThanOrEqual(27);
    for (const w of worn) for (const b of Object.values(w.bodies) as any[]) {
      const sp = (v1.sprites as any[]).find((x) => x.key === b.sprite);
      for (const an of SLEEP_ANIMS) { const a = sp.animations[an];
        expect([a?.frames.length, a?.fps, a?.loop, a?.directions, a?.dirStride, a?.dirFrames.length], `${sp.key}.${an}`).toEqual([4, 2, true, 4, 4, 16]);
        for (const e of a.dirFrames) { expect(e.atlas).toMatch(/^cz_sleep_acc_/); const A = at.get(e.atlas); expect(A?.residency, e.atlas).toBe("stream");
          const { x, y, w: rw, h } = e.rect; expect(x + rw <= A.frameW && y + h <= A.frameH && rw > 0 && h > 0).toBe(true);
          for (const v of [e.anchor.x, e.anchor.y]) { expect(v).toBeGreaterThanOrEqual(-8); expect(v).toBeLessThanOrEqual(9); } }
      }
      expect(Object.values(sp.animations).filter((a: any) => a.dirFrames?.some((e: any) => e.atlas.startsWith("cz_sleep_acc_"))).length, sp.key).toBe(2);
    }
  });

  it("hand anchor angle is DEGREES clockwise from up, same unit as v1 body_male / handOf", () => {
    const deg = (sp: any) => { const out: number[] = []; const walk = (o: any) => { if (o && typeof o === "object") { if (typeof o.handR?.angle === "number") out.push(o.handR.angle); for (const v of Object.values(o)) walk(v); } }; walk(sp); return out; };
    const v2 = deg(sample().sprites.find((x) => x.key === "v2s_body_male")), v1 = deg((cz().sprites as any[]).find((x) => x.key === "body_male"));
    expect(v1.length).toBeGreaterThan(0); expect(v2.length).toBeGreaterThan(0);
    for (const a of [v1, v2]) { expect(Math.max(...a.map(Math.abs)), "radians would stay under 2*PI").toBeGreaterThan(2 * Math.PI); expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(360); }
    expect((side as any).anchorUnits.angle).toMatch(/^DEGREES/);
  });

  it("body frameMeta: head/handR/handL (+ back/hip/footL/footR) on every entry, readable through the registry", () => {
    const s = sample(); const b = s.sprites.find((x) => x.key === "v2s_body_male");
    expect(b.attach).toEqual({ head: { x: 0, y: -26.65 } });
    for (const an of Object.keys(ANIMS)) { const a = b.animations[an];
      for (let i = 0; i < a.dirFrames.length; i++) { const k = a.frameMeta[`df:${i}`]?.anchors; expect(k, `${an} df:${i}`).toBeDefined();
        for (const n of ["head", "handR", "handL", "back", "hip", "footL", "footR"]) expect(k[n], `${an} df:${i} ${n}`).toBeDefined();
        expect(typeof k.handR.angle).toBe("number"); expect(typeof k.handR.len).toBe("number"); expect(typeof k.handR.behind).toBe("boolean");
        expect(Math.abs(k.handR.x)).toBeLessThan(24); expect(k.footL.y).toBeLessThan(6);
        expect(k.carry !== undefined, `${an} df:${i} carry`).toBe(an.startsWith("carry_"));
        if (k.carry) expect(typeof k.carry.behind).toBe("boolean");
        expect(k.seat !== undefined, `${an} df:${i} seat`).toBe(an === "sit" || an === "vehicle");
      } }
    const r = loadManifest(s).registry; const id = r.id("v2s_body_male");
    for (const an of ["attack", "gun_fire", "carry_walk", "vehicle"]) for (let d = 0; d < 8; d++) { const f = r.dirFrame(id, an, (d / 8) * Math.PI * 2, 0.1);
      expect(AssetRegistry.headOffset(f)).toEqual({ x: 0, y: -3 }); expect(f.anchors?.handR).toBeDefined(); expect(f.anchors?.handL).toBeDefined(); }
    expect(r.dirFrame(id, "carry_idle", 0, 0).anchors?.carry).toBeDefined(); expect(r.dirFrame(id, "vehicle", 0, 0).anchors?.seat).toBeDefined();
  });

  it("R/G tint masks: body R only (skin), 2-channel wear uses G; sidecar layers match the sprites", () => {
    expect(side.layers.map((l) => l.sprite).sort()).toEqual([...SPRITES].sort());
    const s = sample();
    for (const l of side.layers) { const sp = s.sprites.find((x) => x.key === l.sprite); expect(sp, l.sprite).toBeDefined(); expect([1, 2]).toContain(l.tintChannels); }
    expect(r8(DIR + s.atlases.find((a) => a.key === "v2s_wr_body_male").masks.tintmask)).toEqual({ r: true, g: false });
    expect(r8(DIR + s.atlases.find((a) => a.key === "v2s_wr_cz_top_henley_male").masks.tintmask)).toEqual({ r: true, g: true });
    expect(r8(DIR + s.atlases.find((a) => a.key === "v2s_wr_body_male__sleep").masks.tintmask)).toEqual({ r: true, g: false });
    expect(r8(DIR + s.atlases.find((a) => a.key === "v2s_wr_cz_bottom_cargo_male__sleep").masks.tintmask)).toEqual({ r: true, g: true });
  });
});

// tiny PNG channel probe (8-bit RGB/RGBA, non-interlaced): does any pixel have R / G set?
import { inflateSync } from "node:zlib";
function r8(path: string): { r: boolean; g: boolean } {
  const b = readFileSync(path); let p = 8; const idat: Buffer[] = []; let w = 0, h = 0, ct = 0;
  while (p < b.length) { const len = b.readUInt32BE(p); const t = b.toString("ascii", p + 4, p + 8); const d = b.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; } else if (t === "IDAT") idat.push(d); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(idat)); const st = w * bpp; const cur = Buffer.alloc(st), prev = Buffer.alloc(st);
  let r = false, g = false;
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)]!; const row = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1));
    for (let i = 0; i < st; i++) { const a = i >= bpp ? cur[i - bpp]! : 0, up = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0; let v = row[i]!;
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[i] = v & 255; }
    for (let x = 0; x < w; x++) { if (cur[x * bpp]! > 127) r = true; if (cur[x * bpp + 1]! > 127) g = true; }
    cur.copy(prev); }
  return { r, g };
}
