/**
 * Build-placement ghost (client-side preview). Survival Systems' `buildPreview {pieceKey, x, y, rot, valid}` is drawn as
 * one dedicated BuildPiece entity through applyBuildPieceVisual/buildPieceVisual with ghost 1 (valid, green) or 2
 * (invalid, red). The sprite shader draws ghosts at ~0.5 alpha with a subtle pulse, depth-sorted with the world
 * (dynamic sprites), and bypasses the lightmap (emissive r) without feeding bloom; the same path runs on ?gl=lowend/safe.
 * Rotation: registry.buildingFrame (unique4 never flipped; 2-row mirror flips rotations 2/3, attach x negated). The
 * caller passes rot already as a quarter turn 0-3 (free-rotation 1/16 steps rounded to the nearest quarter).
 * Position: x/y are the SNAPPED Transform position the real piece will have (not the footprint origin tile); z is
 * level * levelHeight, computed by the caller and passed in opts.z.
 * Tier: opts.tier selects `<piece>@tier<N>` art when the manifest has it (same lookup as placed pieces, buildPieceVisual);
 * drawn untinted apart from the ghost green/red.
 */
import { Transform, type Entity, type World } from "@engine/core";
import type { AssetRegistry, BuildPieceVisual } from "@engine/assets";
import { applyBuildPieceVisual } from "./buildPieces.js";
import type { BuildPieceDefT } from "./sprites.js";
import { pieceArtRow, ROT_EXACT_PIVOT } from "./building/modular.js";

/** Subset of Survival's client-side buildPreview (exact field names). x/y = snapped Transform position of the real piece (not the footprint origin tile), rot = quarter turn 0-3. */
export interface BuildPreview { pieceKey: string; x: number; y: number; rot: number; valid: boolean }

export interface BuildGhostOpts {
  /** world z = level * levelHeight (caller computes) */ z?: number; level?: number;
  /** material tier (preview.tier): its own art if the manifest has `<piece>@tier<N>` */ tier?: number;
  /** gameplay rotation steps of the piece (preview.rotSteps): rot is then the raw step; 12 = triangle 30° steps mapped
   *  exactly onto the art rows (triArtRow), others rounded to the nearest quarter turn */ rotSteps?: number;
  /** pivot at the exact x/y (Placement.Tri centroid / Free vertex) instead of the floored tile */ exactPivot?: boolean;
  variant?: string | number; variantName?: (pieceKey: string, index: number) => string | undefined }

/** Owns the single ghost entity. sync(preview) creates/updates it; sync(null|undefined) removes it. */
export class BuildGhost {
  entity: Entity | null = null; last: BuildPieceVisual | null = null;
  constructor(private readonly world: World, private readonly def: BuildPieceDefT, private readonly registry: AssetRegistry) {}
  sync(p: BuildPreview | null | undefined, opts: BuildGhostOpts = {}): BuildPieceVisual | null {
    const w = this.world;
    if (!p) { if (this.entity !== null && w.isAlive(this.entity)) w.destroy(this.entity); this.entity = null; this.last = null; return null; }
    if (this.entity === null || !w.isAlive(this.entity)) this.entity = w.create();
    const e = this.entity; const t = { x: p.x, y: p.y, z: opts.z ?? 0, facing: 0 };
    if (w.has(e, Transform)) w.set(e, Transform, t); else w.add(e, Transform, t);
    this.last = applyBuildPieceVisual(w, e, this.def, this.registry, { type: 0, rot: opts.rotSteps ? pieceArtRow(p.rot, opts.rotSteps) : p.rot & 3, tint: 0, paint: 0, level: opts.level ?? 0 }, {
      pieceKey: () => p.pieceKey, ghost: p.valid ? 1 : 2,
      ...(opts.variant !== undefined ? { variant: opts.variant } : {}), ...(opts.variantName ? { variantName: opts.variantName } : {}), ...(opts.tier !== undefined ? { tier: opts.tier } : {}) });
    if (opts.exactPivot && w.has(e, this.def)) { const c = w.get(e, this.def)!; w.set(e, this.def, { ...c, rotation: (c.rotation & 3) | ROT_EXACT_PIVOT }); }
    return this.last;
  }
}
