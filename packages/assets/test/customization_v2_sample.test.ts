import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { AssetRegistry, loadManifest, mergeManifests, type ManifestJson } from "../src/index.js";
import { PACK_DIR, imageSizeOf, readManifestJson } from "../src/node.js";
import { MANIFEST_INDEX } from "../../../apps/client/src/manifest-index.js";

// Player v2 SAMPLE (assets/customization/tools/v2_sample.py; spec player_v2_spec.md): an isolated test fragment that sits
// NEXT TO the v1 character art. It must load and merge with the shipped customization pack without a single key
// collision, never replace v1 keys, stream (no resident VRAM) and carry the v2 frame contract: 48x80 / @2x 96x160 frames
// pivoted at (24,74), 8 facings, v1 frame counts/fps, body frameMeta head/handR/handL (+ back/hip/footL/footR).
const DIR = PACK_DIR + "customization_v2_sample/";
const FILE = DIR + "manifest.customization_v2_sample.json";
const sample = () => JSON.parse(readFileSync(FILE, "utf8")) as { atlases: any[]; sprites: any[]; [k: string]: any };
const side = JSON.parse(readFileSync(DIR + "sample.v2.json", "utf8")) as { layers: { sprite: string; slot: string; layer: number; tintChannels: number }[] };
const cz = () => readManifestJson<ManifestJson>(PACK_DIR + "customization/manifest.customization.json");
const pack = () => JSON.parse(readFileSync(PACK_DIR + "manifest.json", "utf8")) as ManifestJson;
const ANIMS = { idle: [4, 4, true], walk: [6, 10, true], attack: [4, 12, false] } as const;   // v1 counts / fps / loop
const SPRITES = ["v2s_body_male", "v2s_cz_bottom_scrap_male", "v2s_cz_shoes_scrap_male", "v2s_cz_top_scrap_male", "v2s_cz_top_scrap_male_sleeves",
  "v2s_cz_face_smile_male", "v2s_cz_eyes_round_male", "v2s_cz_hair_buzz_male_hathair", "v2s_cz_hat_scrap_male"];

describe("customization_v2_sample (player v2 test fragment)", () => {
  it("only new v2s_ keys, merges with pack + customization without collisions and loads", () => {
    const s = sample(); const v1 = cz();
    expect(s.sprites.map((x) => x.key).sort()).toEqual([...SPRITES].sort());
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

  it("is not served by default (isolated) and streams: zero resident VRAM, shard far under 20 MiB", () => {
    expect(MANIFEST_INDEX.some((f) => f.url.includes("customization_v2_sample"))).toBe(false);
    for (const a of sample().atlases) expect(a.residency, a.key).toBe("stream");
    expect(statSync(FILE).size).toBeLessThan(1024 * 1024);
    let px2 = 0;
    for (const a of sample().atlases) {
      for (const p of [a.image, a.masks.tintmask, a.pages[0].image, a.masks.tintmask.replace(/\.png$/, "@2x.png"), a.ktx2, a.pages[0].ktx2, a.masksKtx2.tintmask, a.pages[0].masksKtx2.tintmask]) expect(existsSync(DIR + p), p).toBe(true);
      const s1 = imageSizeOf(DIR + a.image)!, s2 = imageSizeOf(DIR + a.pages[0].image)!;
      expect([s1.w, s1.h]).toEqual([a.frameW, a.frameH]); expect([s2.w, s2.h]).toEqual([a.frameW * 2, a.frameH * 2]);
      px2 += s2.w * s2.h;
    }
    expect((px2 * 4 * 2) / 2 ** 20, "@2x colour + tintmask RGBA8 MiB (streamed)").toBeLessThan(24);
  });

  it("8 facings x idle/walk/attack at v1 counts; rects in page, trimmed from 48x80 frames", () => {
    const s = sample(); const at = new Map(s.atlases.map((a) => [a.key, a]));
    for (const sp of s.sprites) for (const [an, [n, fps, loop]] of Object.entries(ANIMS)) {
      const a = sp.animations[an]; expect(a, `${sp.key}.${an}`).toBeDefined();
      expect([a.frames.length, a.fps, a.loop, a.directions, a.dirStride, a.dirFrames.length]).toEqual([n, fps, loop, 8, n, n * 8]);
      for (const e of a.dirFrames) { const A = at.get(e.atlas)!; const { x, y, w, h } = e.rect;
        expect(x + w <= A.frameW && y + h <= A.frameH && w > 0 && h > 0, `${sp.key}.${an}`).toBe(true);
        for (const v of [e.anchor.x, e.anchor.y]) { expect(v).toBeGreaterThanOrEqual(-8); expect(v).toBeLessThanOrEqual(9); }   // pivot near the rect (loader rule)
        expect(w).toBeLessThanOrEqual(48); expect(h).toBeLessThanOrEqual(80);   // trimmed from a 48x80 frame
      }
    }
  });

  it("body frameMeta: head/handR/handL (+ back/hip/footL/footR) on every entry, readable through the registry", () => {
    const s = sample(); const b = s.sprites.find((x) => x.key === "v2s_body_male");
    expect(b.attach).toEqual({ head: { x: 0, y: -26.65 } });
    for (const an of Object.keys(ANIMS)) { const a = b.animations[an];
      for (let i = 0; i < a.dirFrames.length; i++) { const k = a.frameMeta[`df:${i}`]?.anchors; expect(k, `${an} df:${i}`).toBeDefined();
        for (const n of ["head", "handR", "handL", "back", "hip", "footL", "footR"]) expect(k[n], `${an} df:${i} ${n}`).toBeDefined();
        expect(typeof k.handR.angle).toBe("number"); expect(typeof k.handR.len).toBe("number"); expect(typeof k.handR.behind).toBe("boolean");
        expect(Math.abs(k.handR.x)).toBeLessThan(24); expect(k.footL.y).toBeLessThan(6);
      } }
    const r = loadManifest(s).registry; const id = r.id("v2s_body_male");
    for (let d = 0; d < 8; d++) { const f = r.dirFrame(id, "attack", (d / 8) * Math.PI * 2, 0.1);
      expect(AssetRegistry.headOffset(f)).toEqual({ x: 0, y: -3 }); expect(f.anchors?.handR).toBeDefined(); expect(f.anchors?.handL).toBeDefined(); }
  });

  it("R/G tint masks: body R only (skin), 2-channel wear uses G; sidecar layers match the sprites", () => {
    expect(side.layers.map((l) => l.sprite).sort()).toEqual([...SPRITES].sort());
    const s = sample();
    for (const l of side.layers) { const sp = s.sprites.find((x) => x.key === l.sprite); expect(sp, l.sprite).toBeDefined(); expect([1, 2]).toContain(l.tintChannels); }
    expect(r8(DIR + s.atlases.find((a) => a.key === "v2s_wr_body_male").masks.tintmask)).toEqual({ r: true, g: false });
    expect(r8(DIR + s.atlases.find((a) => a.key === "v2s_wr_cz_top_scrap_male").masks.tintmask)).toEqual({ r: true, g: true });
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
