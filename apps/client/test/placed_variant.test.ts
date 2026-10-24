// ADR-115: placed decor renders its replicated BuildPiece.variant (not always variant 0), like the placement ghost.
import { describe, expect, it } from "vitest";
import { buildPieceVisual, type AssetRegistry } from "@engine/assets";
import { pieceVariantOpts } from "../src/piece-variant.js";

describe("placed piece variant", () => {
  it("maps the stored variant index to the defs variant name", () => {
    const names = ["patch", "gingham", "picnic"];
    expect(pieceVariantOpts(names, 1)).toEqual({ variant: "gingham" });
    expect(pieceVariantOpts(names, 0)).toEqual({ variant: "patch" });
    expect(pieceVariantOpts(undefined, 0)).toEqual({});
    expect(pieceVariantOpts(undefined, 3)).toEqual({ variant: 3 });
  });
  it("buildPieceVisual picks the variant sprite for a placed piece (rotation kept)", () => {
    const ids: Record<string, number> = { stall_blanket: 5, "stall_blanket@gingham": 9 };
    const reg = { clanPaletteForTint: () => undefined, spriteForPiece: (k: string) => ids[k],
      sprite: () => ({ building: { stateNames: [], states: [], layer: 1 } }), buildingFrame: () => 0, animFrame: () => 0 } as unknown as AssetRegistry;
    const piece = { type: 1, rot: 2, tint: 0, paint: 0 };
    const base = buildPieceVisual(reg, piece, { pieceKey: () => "stall_blanket", ...pieceVariantOpts(undefined, 0) });
    const v = buildPieceVisual(reg, piece, { pieceKey: () => "stall_blanket", ...pieceVariantOpts(["patch", "gingham", "picnic"], 1) });
    expect(base.visualId).toBe(5);
    expect(v.visualId).toBe(9); expect(v.variant).toBe("gingham"); expect(v.rotation).toBe(2);
  });
});
