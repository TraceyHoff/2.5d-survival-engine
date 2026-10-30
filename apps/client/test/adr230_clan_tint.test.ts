// ADR-230: in-world clan tint. Pieces whose art sits on a tintmask atlas get [primary, secondary] RGBA8 from
// registry.clanPaletteForTint(paint || tint) (VPiece.tint + renderer pieceTints); unmasked art stays untinted; clan ids
// wrap onto the 16 palettes; Canvas2D applies the same two-tone multiply as the WebGL2 shader.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadManifest, mergeManifests, buildPieceVisual, type ManifestJson } from "@engine/assets";
import { readManifestJson } from "@engine/assets/node";
import { clanTintIndex, CLAN_PALETTE_COUNT } from "@engine/gameplay";
import { clanRgbToRgba8, tintPiecePixels } from "@engine/render";
import { MANIFEST_INDEX } from "../src/manifest-index.js";
import { clanPieceTint, clanPieceTintPair, pieceHasTintMask } from "../src/clan-tint.js";

const root = resolve(__dirname, "../../..");
const repoPath = (url: string) => resolve(root, url.startsWith("pack/") ? "packages/assets/" + url : "assets/" + url);
const served = MANIFEST_INDEX.filter((f) => existsSync(repoPath(f.url))).map((f) => ({ name: f.name, manifest: readManifestJson<ManifestJson>(repoPath(f.url)) }));
const { registry } = loadManifest(mergeManifests(served).manifest, { lock: JSON.parse(readFileSync(resolve(root, "packages/assets/pack/ids.lock.json"), "utf8")) });

/** The pieces the owner listed as clan-tinted in-world (piece key or piece@variant art). */
export const CLAN_TINTED_PIECES = ["rug_1x1", "rug_2x1", "rug_2x2", "rug_3x2", "rug_round", "rug_runner", "curtains", "tapestry", "clan_flag", "vase", "pottery",
  "shield_mount@clan", "fence_picket", "fence_picket@white", "garden_gate@picket", "cabinet_rustic@painted", "cabinet_fine@painted", "dresser_rustic@painted",
  "dresser_fine@painted", "kitchen_cupboard@painted", "desk_rustic@drafting", "desk_fine@drafting"];

describe("ADR-230 in-world clan tint", () => {
  test("clan ids wrap onto the 16 palettes", () => {
    expect(CLAN_PALETTE_COUNT).toBe(16); expect(registry.clanPalettes.length).toBe(16);
    expect([0, 1, 3, 16, 17, 32, 33, 255, 256].map(clanTintIndex)).toEqual([0, 1, 3, 16, 1, 16, 1, 15, 16]);
    for (let id = 1; id <= 300; id++) expect(registry.clanPaletteForTint(clanTintIndex(id)), `clan ${id}`).toBeDefined();
  });

  test("every listed piece resolves to tintmask art and gets the clan pair (paint overrides the clan tint)", () => {
    for (const k of CLAN_TINTED_PIECES) {
      const vid = registry.spriteForPiece(k); expect(vid, k).toBeDefined();
      expect(pieceHasTintMask(registry, vid!), k).toBe(true);
      const pal = registry.clanPaletteForTint(3)!;
      expect(clanPieceTintPair(registry, vid!, 3), k).toEqual([clanRgbToRgba8(pal.primary), clanRgbToRgba8(pal.secondary)]);
      const vis = buildPieceVisual(registry, { type: 1, rot: 0, tint: 3, paint: 7 }, { pieceKey: () => k.split("@")[0], ...(k.includes("@") ? { variant: k.split("@")[1]! } : {}) });
      expect(vis.visualId, k).toBe(vid); expect(vis.tintIndex).toBe(7);
      expect(clanPieceTint(registry, vis), k).toBe(clanRgbToRgba8(registry.clanPaletteForTint(7)!.primary));
      expect(clanPieceTintPair(registry, vid!, 0), k).toBeUndefined(); // no clan, no paint -> untinted
    }
  });

  test("art without a tintmask is never tinted (an unmasked frame would be multiplied whole)", () => {
    const plain = ["wall", "floor", "door", "campfire", "chest"].map((k) => registry.spriteForPiece(k)).filter((v): v is number => v !== undefined && !pieceHasTintMask(registry, v));
    expect(plain.length).toBeGreaterThan(0);
    for (const v of plain) {
      expect(clanPieceTintPair(registry, v, 3)).toBeUndefined();
      expect(clanPieceTint(registry, buildPieceVisual(registry, { type: 1, rot: 0, tint: 3, paint: 0 }, { pieceKey: () => registry.sprite(v).building!.piece }))).toBe(0);
    }
    expect(clanRgbToRgba8(0x2a6fdb)).toBe(0x2a6fdbff);
  });

  test("Canvas2D tintmask multiply matches the WebGL2 shader (R primary, G secondary, 0 secondary = primary)", () => {
    const px = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 0, 100, 100, 100, 255]);
    const mask = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 255, 0, 0, 255]);
    tintPiecePixels(px, mask, 0xff000080 >>> 0, 0x0000ffff);
    expect([...px.slice(0, 3)]).toEqual([200, 0, 0]); // primary on R
    expect([...px.slice(4, 7)]).toEqual([0, 0, 200]); // secondary on G
    expect([...px.slice(8, 11)]).toEqual([200, 200, 200]); // unmasked untouched
    expect([...px.slice(12, 15)]).toEqual([200, 200, 200]); // transparent skipped
    expect([...px.slice(16, 19)]).toEqual([100, 0, 0]);
    const p2 = new Uint8ClampedArray([200, 200, 200, 255]); tintPiecePixels(p2, new Uint8ClampedArray([0, 255, 0, 255]), 0x00ff00ff, 0);
    expect([...p2.slice(0, 3)]).toEqual([0, 200, 0]); // no secondary: G channel takes the primary
  });
});
