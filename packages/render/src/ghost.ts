/**
 * Build-placement ghost (client-side preview). Survival Systems' `buildPreview {pieceKey, x, y, rot, valid}` is drawn as
 * one dedicated BuildPiece entity through applyBuildPieceVisual/buildPieceVisual with ghost 1 (valid, green) or 2
 * (invalid, red). The sprite shader draws ghosts at ~0.5 alpha with a subtle pulse, depth-sorted with the world
 * (dynamic sprites), and bypasses the lightmap (emissive r) without feeding bloom; the same path runs on ?gl=lowend/safe.
 * Rotation: registry.buildingFrame (unique4 never flipped; 2-row mirror flips rotations 2/3, attach x negated).
 */
import { Transform, type Entity, type World } from "@engine/core";
import type { AssetRegistry, BuildPieceVisual } from "@engine/assets";
import { applyBuildPieceVisual } from "./buildPieces.js";
import type { BuildPieceDefT } from "./sprites.js";

/** Mirrors Survival's client-side buildPreview (exact field names). x/y = footprint origin tile, rot 0-3. */
export interface BuildPreview { pieceKey: string; x: number; y: number; rot: number; valid: boolean }

export interface BuildGhostOpts { z?: number; level?: number; variant?: string | number; variantName?: (pieceKey: string, index: number) => string | undefined }

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
    this.last = applyBuildPieceVisual(w, e, this.def, this.registry, { type: 0, rot: p.rot & 3, tint: 0, paint: 0, level: opts.level ?? 0 }, {
      pieceKey: () => p.pieceKey, ghost: p.valid ? 1 : 2,
      ...(opts.variant !== undefined ? { variant: opts.variant } : {}), ...(opts.variantName ? { variantName: opts.variantName } : {}) });
    return this.last;
  }
}
