/**
 * Gameplay BuildPiece -> render BuildPiece (ADR-081). The mapping itself is @engine/assets buildPieceVisual (the only
 * one); this just writes its result into the render component. pieceKey is REQUIRED: without it buildPieceVisual
 * cannot resolve the building sprite and visualId is 0.
 * Render `tint` carries the effective clan tint index (paint || tint) and StallLayer/pieceTints resolve it with
 * registry.clanPaletteForTint.
 */
import { buildPieceVisual, type AssetRegistry, type BuildPieceIn, type BuildPieceVisual } from "@engine/assets";
import type { Entity, World } from "@engine/core";
import type { BuildPieceDefT } from "./sprites.js";

export interface BuildPieceSyncOpts {
  pieceKey: (type: number) => string | undefined; ghost?: boolean | 0 | 1 | 2;
  /** Art variant passed to buildPieceVisual (manifest `<piece>@<variant>`, default sprite when absent). String until Survival ships the name order; numbers need variantName. */
  variant?: string | number; variantName?: (pieceKey: string, index: number) => string | undefined;
  /** Material tier: `<piece>@tier<N>` art when the manifest has it (buildPieceVisual opts.tier). */
  tier?: number;
}
/** Writes buildPieceVisual(registry, piece, opts) into the render BuildPiece of `e` (adds it when missing). Returns the visual. */
export function applyBuildPieceVisual(world: World, e: Entity, def: BuildPieceDefT, registry: AssetRegistry, piece: BuildPieceIn, opts: BuildPieceSyncOpts): BuildPieceVisual {
  const v = buildPieceVisual(registry, piece, { pieceKey: opts.pieceKey, ...(opts.ghost !== undefined ? { ghost: opts.ghost } : {}),
    ...(opts.variant !== undefined ? { variant: opts.variant } : {}), ...(opts.variantName ? { variantName: opts.variantName } : {}), ...(opts.tier !== undefined ? { tier: opts.tier } : {}) });
  const value = { visualId: v.visualId, variant: 0, tint: v.palette ? v.tintIndex : 0, damageStage: v.damageStage, rotation: v.rotation, level: v.level, layer: v.layer, ghost: v.ghost };
  if (world.has(e, def)) world.set(e, def, value); else world.add(e, def, value);
  return v;
}

