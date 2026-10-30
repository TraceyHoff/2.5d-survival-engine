import type { AssetRegistry, BuildPieceVisual } from "@engine/assets";
import { clanRgbToRgba8, clanTintPair } from "@engine/render";

/**
 * ADR-230: in-world clan tint of build pieces. The effective tint index (paint || tint, 1..16) picks
 * registry.clanPaletteForTint; the primary goes to tintmask R (VPiece.tint, RGBA8) and the secondary to tintmask G
 * (renderer pieceTints). Only art on a tintmask atlas is tinted: both renderers multiply an UNMASKED frame by its
 * primary as a whole, so a clan member's walls/floors would turn clan-coloured.
 */
export function pieceHasTintMask(reg: Pick<AssetRegistry, "sprite">, visualId: number): boolean {
  if (!visualId) return false;
  try { return !!reg.sprite(visualId).atlas.masks?.tintmask; } catch { return false; }
}
/** [primary, secondary] RGBA8 for a tinted piece, undefined when untinted / no palette / no tintmask. */
export function clanPieceTintPair(reg: Pick<AssetRegistry, "sprite" | "clanPaletteForTint">, visualId: number, tintIndex: number): readonly [number, number] | undefined {
  if (!tintIndex || !pieceHasTintMask(reg, visualId)) return undefined;
  const t = clanTintPair(reg, tintIndex); return t.primary ? [t.primary, t.secondary] as const : undefined;
}
/** VPiece.tint (RGBA8 primary; 0 = none) for a resolved piece visual. */
export function clanPieceTint(reg: Pick<AssetRegistry, "sprite" | "clanPaletteForTint">, vis: Pick<BuildPieceVisual, "visualId" | "palette">): number {
  return vis.palette && pieceHasTintMask(reg, vis.visualId) ? clanRgbToRgba8(vis.palette.primary) : 0;
}
