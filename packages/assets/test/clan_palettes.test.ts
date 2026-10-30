import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadManifest, mergeManifests, buildPieceVisual, type ManifestJson } from "../src/index.js";
import { readManifestJson } from "../src/node.js";
import { MANIFEST_INDEX } from "../../../apps/client/src/manifest-index.js";

// Clan palettes in-game. Source of truth: assets/pvp_clan/clan_palettes.json. The pvp_clan fragment is NOT in the client's
// MANIFEST_INDEX, so the building manifest (served) carries a generated copy as `clanPalettes`
// (pack/building/src/clan_palettes.py, also run by build.py). This test pins the copy to the source and checks that the
// fragments the client actually merges yield the palettes through AssetRegistry.clanPaletteForTint, plus the tintmask
// (R = primary, G = secondary) of every clan-tinted decor sprite.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(root + f, "utf8"));
type Pal = { key: string; primary: string; secondary: string };
const source = (read("assets/pvp_clan/clan_palettes.json").palettes as (Pal & { index: number })[]);
const BLD = "packages/assets/pack/building/manifest.building.json";
const bld = read(BLD) as { clanPalettes?: Pal[]; atlases: Atlas[]; sprites: Sprite[] };
type Atlas = { key: string; image: string; frameW: number; frameH: number; columns: number; masks?: { tintmask?: string }; masksKtx2?: { tintmask?: string }; pages?: { scale: number; image: string; masksKtx2?: { tintmask?: string } }[] };
type Sprite = { key: string; atlas: string; building?: { piece: string; frames: number[][] } };

// client url (relative to <art>/) -> repo path, as vite.config.ts serves them
const repoPath = (url: string) => (url.startsWith("pack/") ? "packages/assets/" + url : "assets/" + url);
const served = MANIFEST_INDEX.filter((f) => existsSync(root + repoPath(f.url))).map((f) => ({ name: f.name, manifest: readManifestJson<ManifestJson>(root + repoPath(f.url)) }));

describe("clan palettes are served to the client", () => {
  it("building manifest copy == clan_palettes.json == pvp_clan fragment (order = tint index - 1)", () => {
    expect(source.map((p) => p.index)).toEqual(source.map((_, i) => i));
    const want = source.map(({ key, primary, secondary }) => ({ key, primary, secondary }));
    expect(want.length).toBe(16);
    expect(bld.clanPalettes).toEqual(want);
    expect(read("assets/pvp_clan/manifest.fragment.json").clanPalettes).toEqual(want);
  });
  it("exactly one served fragment defines clanPalettes (merge appends, a second copy would shift nothing but double N)", () => {
    expect(served.find((f) => f.name === "pack")).toBeDefined();
    expect(served.filter((f) => (f.manifest.clanPalettes?.length ?? 0) > 0).map((f) => f.name)).toEqual(["building"]);
  });
  const merged = mergeManifests(served);
  const { registry } = loadManifest(merged.manifest, { lock: read("packages/assets/pack/ids.lock.json") });
  it("the client's merged registry resolves BuildPiece.tint 1..16 -> palettes (0 / 17 = none)", () => {
    expect(registry.clanPalettes.length).toBe(16);
    source.forEach((p, i) => {
      const c = registry.clanPaletteForTint(i + 1)!;
      expect(c.key).toBe(p.key);
      expect(c.primary).toBe(parseInt(p.primary.slice(1), 16)); expect(c.secondary).toBe(parseInt(p.secondary.slice(1), 16));
    });
    expect(registry.clanPaletteForTint(0)).toBeUndefined(); expect(registry.clanPaletteForTint(17)).toBeUndefined();
  });
  it("buildPieceVisual gives clan-tinted pieces a palette (paint wins over tint)", () => {
    for (const key of TINTED) {
      const v = buildPieceVisual(registry, { type: 1, rot: 0, tint: 2, paint: 0 }, { pieceKey: () => key });
      expect(v.visualId, key).toBeGreaterThan(0); expect(v.palette?.key, key).toBe(source[1]!.key);
      expect(buildPieceVisual(registry, { type: 1, rot: 0, tint: 2, paint: 5 }, { pieceKey: () => key }).palette?.key).toBe(source[4]!.key);
    }
  });
});

// ---------------------------------------------------------------------------------------------- tintmask channels
/** Pieces whose every variant is clan cloth / paint (R) - two-tone variants also carry G. */
const TINTED = ["rug_1x1", "rug_2x1", "rug_2x2", "rug_3x2", "rug_round", "rug_runner", "curtains", "tapestry", "clan_flag", "vase", "pottery"];
/** Single variants that are tinted (the piece's other variants are bare wood / metal by design). */
const TINTED_VARIANTS = ["shield_mount@clan", "fence_picket", "fence_picket@white", "garden_gate", "garden_gate@picket", "cabinet_rustic@painted", "cabinet_fine@painted", "dresser_rustic@painted", "dresser_fine@painted", "kitchen_cupboard@painted"];

/** Minimal PNG decoder: 8-bit RGB / RGBA, non-interlaced (what the decor build writes). */
function png(file: string): { w: number; h: number; ch: number; px: Uint8Array } {
  const b = readFileSync(file); let o = 8; let w = 0, h = 0, ch = 0; const idat: Buffer[] = [];
  while (o < b.length) {
    const n = b.readUInt32BE(o), t = b.toString("ascii", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + n);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); expect(d[8]).toBe(8); expect(d[12]).toBe(0); ch = d[9] === 6 ? 4 : d[9] === 2 ? 3 : 0; expect(ch, file).toBeGreaterThan(0); }
    else if (t === "IDAT") idat.push(d); else if (t === "IEND") break;
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)); const st = w * ch; const px = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)]!; const src = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)); const row = y * st;
    for (let x = 0; x < st; x++) {
      const a = x >= ch ? px[row + x - ch]! : 0, up = y ? px[row - st + x]! : 0, c = y && x >= ch ? px[row - st + x - ch]! : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      px[row + x] = (src[x]! + pred) & 255;
    }
  }
  return { w, h, ch, px };
}

describe("clan-tinted decor sprites have correct tintmask channels", () => {
  const atlases = new Map(bld.atlases.map((a) => [a.key, a])); const cache = new Map<string, ReturnType<typeof png>>();
  const img = (p: string) => { let i = cache.get(p); if (!i) cache.set(p, (i = png(root + "packages/assets/pack/building/" + p))); return i; };
  const stats = (s: Sprite) => {
    const a = atlases.get(s.atlas)!; const base = img(a.image), mask = img(a.masks!.tintmask!);
    expect([mask.w, mask.h]).toEqual([base.w, base.h]);
    let op = 0, r = 0, g = 0, out = 0, rl = 0, gl = 0;
    for (const f of new Set(s.building!.frames.flat())) {
      const x0 = (f % a.columns) * a.frameW, y0 = Math.floor(f / a.columns) * a.frameH;
      for (let y = y0; y < y0 + a.frameH; y++) for (let x = x0; x < x0 + a.frameW; x++) {
        const bi = (y * base.w + x) * 4, mi = (y * mask.w + x) * mask.ch; const al = base.px[bi + 3]!;
        const lum = 0.299 * base.px[bi]! + 0.587 * base.px[bi + 1]! + 0.114 * base.px[bi + 2]!;
        const R = mask.px[mi]!, G = mask.px[mi + 1]!;
        if (al === 0 && (R || G)) out++;
        if (al < 128) continue; op++;
        if (R >= 128) { r++; rl += lum; } if (G >= 128) { g++; gl += lum; }
      }
    }
    return { op, r: r / op, g: g / op, out, rl: r ? rl / r : 0, gl: g ? gl / g : 0 };
  };
  const byPiece = (pred: (piece: string) => boolean) => bld.sprites.filter((s) => s.building && pred(s.building.piece));
  const want = [...byPiece((p) => TINTED.includes(p.split("@")[0]!)), ...byPiece((p) => TINTED_VARIANTS.includes(p))];

  it("every clan-tinted sprite sits on a tintmask atlas with 1x/@2x png + ktx2 masks", () => {
    expect(want.length).toBeGreaterThanOrEqual(80);
    for (const s of want) {
      const a = atlases.get(s.atlas)!; const p2 = a.pages?.find((p) => p.scale === 2);
      for (const f of [a.masks?.tintmask, a.masks?.tintmask?.replace(".tintmask.png", ".tintmask@2x.png"), a.masksKtx2?.tintmask, p2?.masksKtx2?.tintmask])
        expect(f && existsSync(root + "packages/assets/pack/building/" + f), `${s.key} ${f}`).toBe(true);
    }
  });
  it("R (primary) covers the cloth / paint on light base art; G (secondary) is the pattern / trim; nothing outside alpha", () => {
    for (const s of want) {
      const t = stats(s); const piece = s.building!.piece;
      expect(t.out, s.key).toBe(0);
      expect(t.r, s.key).toBeGreaterThan(TINTED.includes(piece.split("@")[0]!) ? 0.25 : 0.1);
      expect(t.rl, s.key).toBeGreaterThan(128); // multiply tint needs light art underneath to show the clan colour
      if (t.g > 0.01) expect(t.gl, s.key).toBeGreaterThan(110);
      if (/^rug_.*@(striped|checker|diamond|floral|border|tribal|braided)$/.test(piece)) expect(t.g, s.key).toBeGreaterThan(0.1);
    }
  });
  it("untinted art (e.g. fence_picket@natural) has an empty mask", () => {
    for (const s of byPiece((p) => ["fence_picket@natural", "fence_picket@rustic", "garden_gate@iron", "cabinet_rustic@plain"].includes(p))) {
      const t = stats(s); expect(t.r + t.g, s.key).toBe(0); expect(t.out).toBe(0);
    }
  });
});
