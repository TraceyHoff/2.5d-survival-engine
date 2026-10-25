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
import { pieceCost, snapPlacement, validatePlacement } from "../building/place.js";
import { maxHpOf } from "../building/integrity.js";
import { BuildPiece, Dead, PieceSlot } from "../components.js";
import { DemolishCmd, RepairCmd, UpgradeCmd } from "../input.js";
import { countItem } from "../inventory.js";
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
  /** Touch snap assist (ADR-104) moved the request to a nearby valid snap; `request` holds the moved point. */
  assisted?: boolean;
  /** Unsnapped request (reach-clamped aim point + requested rot) that placePreviewIntent sends. */
  request: { x: number; y: number; rot: number };
}
export interface PlacementAim { x: number; y: number; mode: number }
export const PLACE_AHEAD = 2;

export function rotationSteps(world: World, piece: number): number {
  const d = gameplayDefs(world); const def = d.pieces.get(piece);
  return def?.placement === Placement.Tri ? 12 : def?.placement === Placement.Free ? def.rotSteps || d.building.freeRotSteps : 4;
}
export const rotateStep = (world: World, piece: number, rot: number, dir: 1 | -1): number => { const n = rotationSteps(world, piece); return (((rot + dir) % n) + n) % n; };

/** Target world point for an aim, clamped to reach. */
export function placementTarget(world: World, player: Entity, aim: PlacementAim | undefined): { x: number; y: number } | undefined {
  const t = world.get(player, Transform); if (!t) return undefined; const reach = gameplayDefs(world).building.buildReach;
  if (!aim) return { x: t.x + PLACE_AHEAD, y: t.y };
  if (aim.mode === 1) { const dx = aim.x - t.x, dy = aim.y - t.y, d = Math.hypot(dx, dy); const k = d > reach ? reach / d : 1; return { x: t.x + dx * k, y: t.y + dy * k }; }
  const n = Math.hypot(aim.x, aim.y) || 1; const a = Math.min(PLACE_AHEAD, reach); return { x: t.x + (aim.x / n) * a, y: t.y + (aim.y / n) * a };
}

/** Max distance a snap moves a piece's centre from the aim point (half a tile diagonal, rounded up). */
export const SNAP_REACH_MARGIN = 0.75;
/** ADR-142: an aim clamped to the very edge of reach snapped outward and read "Too far away" (the ghost flipped red at the
 *  rim, e.g. after rotating). Pull the request in by SNAP_REACH_MARGIN so whatever it snaps to stays in reach. */
function withinSnapReach(world: World, player: Entity, at: { x: number; y: number }): { x: number; y: number } {
  const t = world.get(player, Transform); return t ? clampToSnapReach(t, at, gameplayDefs(world).building.buildReach) : at;
}
/** Pure core of withinSnapReach: `at` pulled toward `from` to at most reach − SNAP_REACH_MARGIN. */
export function clampToSnapReach(from: { x: number; y: number }, at: { x: number; y: number }, reach: number): { x: number; y: number } {
  const lim = reach - SNAP_REACH_MARGIN; const dx = at.x - from.x, dy = at.y - from.y, dd = Math.hypot(dx, dy); if (dd <= lim || lim <= 0) return at;
  return { x: from.x + (dx * lim) / dd, y: from.y + (dy * lim) / dd };
}
/** Snap-assist probe ring (tiles): 8 directions at 0.5 then 1.0 tiles, fixed order (deterministic). */
export const SNAP_ASSIST_RING: readonly (readonly [number, number])[] = [0.5, 1].flatMap((r) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.round(Math.cos((k * Math.PI) / 4) * r * 1e6) / 1e6, Math.round(Math.sin((k * Math.PI) / 4) * r * 1e6) / 1e6] as const));
/**
 * Preview with touch snap assist: when the direct aim is invalid and assist is on (default for stick/touch aim,
 * mode 0; `assist` overrides), the first valid preview from SNAP_ASSIST_RING around the aim is returned instead.
 */
export function buildPreviewFor(world: World, player: Entity, sel: BuildSelection, rot: number, aim: PlacementAim | undefined, level = 0, assist?: boolean): BuildPreview | undefined {
  const p = rawPreview(world, player, sel, rot, aim, level);
  if (!p || p.valid || !(assist ?? (aim !== undefined && aim.mode !== 1))) return p;
  const at = placementTarget(world, player, aim)!;
  for (const [dx, dy] of SNAP_ASSIST_RING) {
    const q = rawPreview(world, player, sel, rot, { mode: 1, x: at.x + dx, y: at.y + dy }, level);
    if (q?.valid) return { ...q, assisted: true };
  }
  return p;
}
function rawPreview(world: World, player: Entity, sel: BuildSelection, rot: number, aim: PlacementAim | undefined, level: number): BuildPreview | undefined {
  const d = gameplayDefs(world); const def = d.pieces.get(sel.piece); const at0 = placementTarget(world, player, aim); if (!def || !at0) return undefined;
  const at = withinSnapReach(world, player, at0);
  const sn = snapPlacement(world, { piece: sel.piece, x: at.x, y: at.y, level, rot, tier: sel.tier, variant: sel.variant });
  const base = { pieceKey: def.key, piece: def.id, tier: sel.tier, variant: sel.variant, paint: sel.paint, level, rotSteps: rotationSteps(world, sel.piece), request: { x: at.x, y: at.y, rot } };
  if (typeof sn === "number") return { ...base, x: at.x, y: at.y, z: level * d.building.levelHeight, rot, valid: false, reason: sn };
  const reason = validatePlacement(world, player, sn);
  return { ...base, tier: sn.tier, variant: sn.variant, x: sn.pos.x, y: sn.pos.y, z: sn.pos.z, rot: sn.slot.rot, valid: reason === 0, reason };
}
/** PlaceCmd for a preview (raw rot as requested; the server re-snaps the same way). */
export const placePreviewIntent = (p: BuildPreview): MenuIntent =>
  placeIntent({ piece: p.piece, tier: p.tier, variant: p.variant, paint: p.paint }, { x: p.request.x, y: p.request.y, level: p.level, rot: p.request.rot });

// ---- ADR-136: targeted placed piece (contextual Repair / Upgrade / Demolish) -----------------------------------
export interface PieceTarget {
  entity: Entity; piece: number; pieceKey: string; level: number; tier: number; tierKey: string; hp: number; maxHp: number;
  /** Next tier for Upgrade (undefined when not tiered / already top tier). */
  nextTier: number | undefined; nextTierKey: string | undefined;
  canRepair: boolean; canUpgrade: boolean; canAfford: { repair: boolean; upgrade: boolean };
}
/** Placed piece nearest the aim point (within `radius` tiles, same level preferred) that is in build reach; undefined if none. */
export function pieceTargetAt(world: World, player: Entity, at: { x: number; y: number } | undefined, level = 0, radius = 0.9): PieceTarget | undefined {
  const pt = world.get(player, Transform); if (!pt || !at || !world.isRegistered(BuildPiece)) return undefined;
  const d = gameplayDefs(world); const reach = d.building.buildReach + 1;
  let best: Entity | undefined; let bestD = Infinity;
  for (const e of world.query([BuildPiece, Transform], [Dead])) {
    const t = world.get(e, Transform)!; if (Math.hypot(t.x - pt.x, t.y - pt.y) > reach) continue;
    const z = world.getField(e, PieceSlot, "z") ?? Math.round(t.z / d.building.levelHeight);
    const dist = Math.hypot(t.x - at.x, t.y - at.y) + (z === level ? 0 : 0.5 + Math.abs(z - level));
    if (dist <= radius + (z === level ? 0 : 0.5 + Math.abs(z - level)) && dist < bestD) { bestD = dist; best = e; }
  }
  if (best === undefined) return undefined;
  const bp = world.get(best, BuildPiece)!; const def = d.pieces.get(bp.type); if (!def) return undefined;
  const maxHp = maxHpOf(world, best); const tierKey = (id: number) => d.tiers.find((x) => x.id === id)?.key ?? String(id);
  const next = def.tiered && bp.tier + 1 < d.tiers.length ? bp.tier + 1 : undefined;
  const has = (cost: { item: number; count: number }[]) => cost.every((c) => countItem(world, player, c.item) >= c.count);
  const missing = 1 - bp.hp / Math.max(1, maxHp); const mul = d.tiers[bp.tier]?.repairMul ?? 0.3;
  return { entity: best, piece: def.id, pieceKey: def.key, level: world.getField(best, PieceSlot, "z") ?? 0, tier: bp.tier, tierKey: tierKey(bp.tier), hp: bp.hp, maxHp,
    nextTier: next, nextTierKey: next === undefined ? undefined : tierKey(next), canRepair: bp.hp < maxHp, canUpgrade: next !== undefined,
    canAfford: { repair: has(pieceCost(d, def, bp.tier, mul * missing)), upgrade: next !== undefined && has(pieceCost(d, def, next)) } };
}
export const repairIntent = (target: Entity): MenuIntent => ({ cmd: RepairCmd, args: { target }, entities: ["target"] });
export const upgradeIntent = (target: Entity, tier: number): MenuIntent => ({ cmd: UpgradeCmd, args: { target, tier }, entities: ["target"] });
export const demolishIntent = (target: Entity): MenuIntent => ({ cmd: DemolishCmd, args: { target }, entities: ["target"] });
