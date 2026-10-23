import type { AssetRegistry, ClanPalette, FrameRef } from "./manifest.js";

/**
 * THE single BuildPiece gameplay -> render mapping (ADR-081). Gameplay stores {type, rot, tint, paint, damageStage, ...}
 * (packages/gameplay BuildPiece); render draws {visualId, rotation, damageStage, level, layer, ghost, tint}
 * (packages/render BuildPieceDefT). Nothing else may re-derive these fields.
 *  - visualId: building sprite whose `building.piece` equals the piece def key (opts.pieceKey resolves type -> key).
 *  - frame: registry.buildingFrame(visualId, rot, damageStage, stateIndex) (handles 1/2/4 rotation rows + flipX, states).
 *  - crack: crackOverlay sprite anim stage1..3 for damage stages 1-3 (only when the sprite declares crackOverlay).
 *  - layer: manifest building.layer; level passes through (default 0).
 *  - palette: clan palette of the effective tint index = paint when paint != 0, else tint (clanPaletteForTint).
 *  - ghost: 0 none, 1 valid preview, 2 invalid preview (render shader convention).
 */
export interface BuildPieceIn { type: number; rot: number; tint: number; paint: number; damageStage?: number; state?: number | string; level?: number }
export interface BuildPieceVisualOpts {
  /** 0/false = none, 1/true = valid ghost, 2 = invalid ghost. */
  ghost?: boolean | 0 | 1 | 2;
  /** Piece type id -> BuildPieceDef key (e.g. (t) => defs.pieces.get(t)?.key). */
  pieceKey?: (type: number) => string | undefined;
}
export interface BuildPieceVisual {
  visualId: number; rotation: number; damageStage: number; stateIndex: number;
  frame?: FrameRef; crack?: { sprite: number; anim: string; frame: FrameRef };
  level: number; layer: number; ghost: 0 | 1 | 2; tintIndex: number; palette?: ClanPalette;
}

export function buildPieceVisual(registry: AssetRegistry, piece: BuildPieceIn, opts: BuildPieceVisualOpts = {}): BuildPieceVisual {
  const g = opts.ghost; const ghost: 0 | 1 | 2 = g === true ? 1 : g === false || g === undefined ? 0 : g;
  const tintIndex = piece.paint ? piece.paint : piece.tint; const palette = registry.clanPaletteForTint(tintIndex);
  const rotation = piece.rot & 3; const damageStage = Math.max(0, Math.min(3, (piece.damageStage ?? 0) | 0)); const level = piece.level ?? 0;
  const key = opts.pieceKey?.(piece.type); const visualId = key === undefined ? 0 : registry.spriteForPiece(key) ?? 0;
  const base = { rotation, damageStage, level, ghost, tintIndex, ...(palette ? { palette } : {}) };
  if (!visualId) return { visualId: 0, stateIndex: -1, layer: 0, ...base };
  const b = registry.sprite(visualId).building!;
  const stateIndex = typeof piece.state === "string" ? b.stateNames.indexOf(piece.state) : piece.state !== undefined && piece.state >= 0 && piece.state < b.states.length ? piece.state : -1;
  const frame = registry.buildingFrame(visualId, rotation, damageStage, stateIndex);
  let crack: BuildPieceVisual["crack"];
  if (b.crackOverlay !== undefined && damageStage > 0) { const anim = `stage${damageStage}`; crack = { sprite: b.crackOverlay, anim, frame: registry.animFrame(b.crackOverlay, anim, rotation, 0) }; }
  return { visualId, stateIndex, frame, ...(crack ? { crack } : {}), layer: b.layer, ...base };
}
