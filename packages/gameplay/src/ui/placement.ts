/**
 * Client build placement (owned by gameplay): turns the input aim + build selection into a snapped, reach-clamped,
 * validated preview, and the PlaceCmd intent for it. Browser-safe, pure over the local replica.
 *  - aim.mode 1 (AimMode.WorldPoint: cursor / touch world point): target = that point, clamped to buildReach.
 *  - aim.mode 0 (AimMode.Direction: stick / last move dir from AimResolver): target = player + dir * PLACE_AHEAD.
 *  - snapped with snapPlacement (grid / edge / free steps), validated with validatePlacement (range, privilege,
 *    terrain, overlap, support, cost). Server re-validates on PlaceCmd.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { gameplayDefs } from "../config.js";
import { Placement } from "../defs.js";
import { snapPlacement, validatePlacement } from "../building/place.js";
import { placeIntent, type BuildSelection, type MenuIntent } from "./menus.js";

/** Renderer contract: draw the ghost of `pieceKey` at (x, y, level) with `rot`, tinted valid/invalid. */
export interface BuildPreview {
  /** BuildPiece def key (gameplayDefs(world).pieces) — the Renderer maps it to the piece visual. */
  pieceKey: string; piece: number; tier: number; variant: number; paint: number;
  /** Snapped world position (tiles) — the placed piece's Transform x/y (piece centre, as replicated pieces) — and build level (0 = ground). */
  x: number; y: number; level: number;
  /** World height of the snapped slot (level * levelHeight; same as the placed piece's Transform.z). */
  z: number;
  /** Snapped rotation step: 0..3 quarter turns for cell/edge/opening pieces, 0..freeRotSteps-1 for free pieces. */
  rot: number; rotSteps: number;
  /** Placement would pass client validation; `reason` is the BuildFail code (0 when valid). */
  valid: boolean; reason: number;
  /** Unsnapped request (reach-clamped aim point + requested rot) that placePreviewIntent sends. */
  request: { x: number; y: number; rot: number };
}
export interface PlacementAim { x: number; y: number; mode: number }
export const PLACE_AHEAD = 2;

export function rotationSteps(world: World, piece: number): number {
  const d = gameplayDefs(world); const def = d.pieces.get(piece);
  return def?.placement === Placement.Free ? d.building.freeRotSteps : 4;
}
export const rotateStep = (world: World, piece: number, rot: number, dir: 1 | -1): number => { const n = rotationSteps(world, piece); return (((rot + dir) % n) + n) % n; };

/** Target world point for an aim, clamped to reach. */
export function placementTarget(world: World, player: Entity, aim: PlacementAim | undefined): { x: number; y: number } | undefined {
  const t = world.get(player, Transform); if (!t) return undefined; const reach = gameplayDefs(world).building.buildReach;
  if (!aim) return { x: t.x + PLACE_AHEAD, y: t.y };
  if (aim.mode === 1) { const dx = aim.x - t.x, dy = aim.y - t.y, d = Math.hypot(dx, dy); const k = d > reach ? reach / d : 1; return { x: t.x + dx * k, y: t.y + dy * k }; }
  const n = Math.hypot(aim.x, aim.y) || 1; const a = Math.min(PLACE_AHEAD, reach); return { x: t.x + (aim.x / n) * a, y: t.y + (aim.y / n) * a };
}

export function buildPreviewFor(world: World, player: Entity, sel: BuildSelection, rot: number, aim: PlacementAim | undefined, level = 0): BuildPreview | undefined {
  const d = gameplayDefs(world); const def = d.pieces.get(sel.piece); const at = placementTarget(world, player, aim); if (!def || !at) return undefined;
  const sn = snapPlacement(world, { piece: sel.piece, x: at.x, y: at.y, level, rot, tier: sel.tier, variant: sel.variant });
  const base = { pieceKey: def.key, piece: def.id, tier: sel.tier, variant: sel.variant, paint: sel.paint, level, rotSteps: rotationSteps(world, sel.piece), request: { x: at.x, y: at.y, rot } };
  if (typeof sn === "number") return { ...base, x: at.x, y: at.y, z: level * d.building.levelHeight, rot, valid: false, reason: sn };
  const reason = validatePlacement(world, player, sn);
  return { ...base, tier: sn.tier, variant: sn.variant, x: sn.pos.x, y: sn.pos.y, z: sn.pos.z, rot: sn.slot.rot, valid: reason === 0, reason };
}
/** PlaceCmd for a preview (raw rot as requested; the server re-snaps the same way). */
export const placePreviewIntent = (p: BuildPreview): MenuIntent =>
  placeIntent({ piece: p.piece, tier: p.tier, variant: p.variant, paint: p.paint }, { x: p.request.x, y: p.request.y, level: p.level, rot: p.request.rot });
