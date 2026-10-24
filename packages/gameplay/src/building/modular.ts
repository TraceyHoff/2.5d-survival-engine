/**
 * Modular base-building set (ADR-104): triangle geometry, art variant keys, raid multipliers and the raid rule hook.
 * Pure and browser-safe; no randomness (nothing here needs world.rngFor).
 *
 * Triangles (placement "tri") are unit equilateral triangles. rot is in 30 degree steps (0..11); edge k (0..2) has
 * its outward normal at (rot + 4k) * 30 degrees, its midpoint at centroid + TRI_INRADIUS * normal. Snapping a
 * triangle to a square edge or to another triangle's edge therefore yields 60/120 degree corners and keeps every
 * pose on the 30-degree lattice. Axis-aligned triangle edges that land on grid edges carry walls and support decks.
 */
import { type Entity, type World } from "@engine/core";
import { hasPlayerId } from "../combat/pvp.js";
import { BuildPiece, DamageCause, PlayerIntent } from "../components.js";
import { RaidRuleRes, setRaidRule, type RaidRule } from "../combat/arms.js";
import { gameplayDefs } from "../config.js";
import type { GameDefs, PieceDef, RaidMuls } from "../defs.js";

export const TRI_INRADIUS = Math.sqrt(3) / 6;
export const TRI_ROT_STEPS = 12;
const STEP = Math.PI / 6;

export interface TriEdge { mx: number; my: number; nx: number; ny: number; dirStep: number }
/** The 3 edges of a triangle at centroid (x,y) with rot (0..11). Deterministic order k = 0,1,2. */
export function triEdges(x: number, y: number, rot: number): TriEdge[] {
  const out: TriEdge[] = [];
  for (let k = 0; k < 3; k++) {
    const dirStep = (((rot + 4 * k) % 12) + 12) % 12; const a = dirStep * STEP;
    const nx = snapUnit(Math.cos(a)), ny = snapUnit(Math.sin(a));
    out.push({ mx: x + TRI_INRADIUS * nx, my: y + TRI_INRADIUS * ny, nx, ny, dirStep });
  }
  return out;
}
/** Exact 0/±1/±0.5 for lattice angles so axis-aligned edges hit integer grid lines without drift. */
function snapUnit(v: number): number { for (const c of [0, 0.5, -0.5, 1, -1]) if (Math.abs(v - c) < 1e-12) return c; return v; }
/** Rot (0..11) whose edge 0 normal points along step `dirStep`. */
export const triRotFacing = (dirStep: number): number => ((dirStep % 12) + 12) % 12;
/** Grid edge for an axis-aligned triangle edge lying on a grid line (tx, ty, side 1 North | 2 West), else undefined. */
export function triGridEdge(e: TriEdge): { tx: number; ty: number; side: 1 | 2 } | undefined {
  const near = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-4;
  if (e.nx === 0 && near(e.my) && near(e.mx - 0.5)) return { tx: Math.round(e.mx - 0.5), ty: Math.round(e.my), side: 1 };
  if (e.ny === 0 && near(e.mx) && near(e.my - 0.5)) return { tx: Math.round(e.mx), ty: Math.round(e.my - 0.5), side: 2 };
  return undefined;
}
/** Quantized centroid key (1/16 tile). */
export const triKey = (x: number, y: number, z: number): number => ((Math.round(x * 16) + (1 << 21)) * 2 ** 22 + (Math.round(y * 16) + (1 << 21))) * 16 + z;

// ---- art keys --------------------------------------------------------------------------------------------------
/** Crack overlay sprite every building sprite declares (assets/building/KEYS.md); damage is not part of the key. */
export const BUILD_CRACK_OVERLAY = "bld_crack";
/** bld_crack animation for BuildPiece.damageStage (0 intact -> "", 1 scuffed, 2 cracked, 3 wrecked -> "stage1".."stage3"). */
export const crackOverlayAnim = (stage: number): string => (stage > 0 ? `stage${Math.min(3, stage)}` : "");
/**
 * Sprite lookup key (ADR-104). Two forms:
 * - `pieceVariantKey(defs, buildPiece)` -> `<pieceKey>@tier<N>`: N = material tier (1 wood, 2 stone, 3 metal,
 *   4 reinforced; twig (0) and untiered pieces -> bare key). e.g. `wall_window@tier2`. Damage stage is not in the key:
 *   draw BUILD_CRACK_OVERLAY with animation crackOverlayAnim(damageStage). Use pieceVariantKeyChain for the Renderer fallback order.
 * - `pieceVariantKey(def, variant)` -> `<piece>@<variantName>` for named art variants (stalls), or the bare key.
 */
export function pieceVariantKey(def: { key: string; variantNames: readonly string[] }, variant: number): string;
export function pieceVariantKey(defs: GameDefs, p: { type: number; tier: number; damageStage?: number }): string;
export function pieceVariantKey(a: GameDefs | { key: string; variantNames: readonly string[] }, b: number | { type: number; tier: number; damageStage?: number }): string {
  if (typeof b === "number") { const d = a as { key: string; variantNames: readonly string[] }; const n = d.variantNames[b]; return n ? `${d.key}@${n}` : d.key; }
  const def = (a as GameDefs).pieces.get(b.type); if (!def) return "";
  return variantKeyFor(def, b.tier);
}
/** `<key>@tier<N>` (tiers 1..4 have art; tier0 twig keeps the main pack's bare/`_twig` art). Untiered: bare key. */
export const variantKeyFor = (def: Pick<PieceDef, "key" | "tiered">, tier: number): string => (def.tiered && tier > 0 ? `${def.key}@tier${tier}` : def.key);
/** Renderer fallback order: tier art, then bare sprite. Damage is drawn with BUILD_CRACK_OVERLAY / crackOverlayAnim. */
export function pieceVariantKeyChain(defs: GameDefs, p: { type: number; tier: number; damageStage?: number }): string[] {
  const def = defs.pieces.get(p.type); if (!def) return [];
  return p.tier > 0 && def.tiered ? [variantKeyFor(def, p.tier), def.key] : [def.key];
}
/** Every art key for the modular set: family pieces x tier1..4 (twig falls back via pieceVariantKeyChain) (damage = crack overlay, not a key). */
export function modularArtKeys(defs: GameDefs): string[] {
  const out: string[] = [];
  for (const def of [...defs.pieces.values()].filter((d) => d.family).sort((a, b) => a.id - b.id))
    for (let t = Math.max(def.minTier, 1); t < defs.tiers.length; t++) out.push(variantKeyFor(def, t));
  return out;
}

// ---- raid -------------------------------------------------------------------------------------------------------
export const enum RaidDamage { Other = 0, Melee = 1, Explosive = 2, Fire = 3 }
export const raidKindOf = (cause: DamageCause | undefined): RaidDamage =>
  cause === DamageCause.Combat ? RaidDamage.Melee : cause === DamageCause.Explosion ? RaidDamage.Explosive : cause === DamageCause.Fire ? RaidDamage.Fire : RaidDamage.Other;
/** Tier multiplier for a raid damage kind (Other = 1). */
export function raidMul(defs: GameDefs, tier: number, kind: RaidDamage): number {
  const r: RaidMuls | undefined = defs.tiers[tier]?.raid; if (!r || kind === RaidDamage.Other) return 1;
  return kind === RaidDamage.Melee ? r.melee : kind === RaidDamage.Explosive ? r.explosive : r.fire;
}
/** Player-caused damage to a piece after raid multipliers (attackers without PlayerId/PlayerIntent, e.g. zombies, are unscaled; fire always scales). */
export function raidScaled(world: World, defs: GameDefs, piece: Entity, amount: number, attacker: Entity | undefined, cause: DamageCause | undefined): number {
  if (cause === DamageCause.Fire) return amount * raidMul(defs, world.getField(piece, BuildPiece, "tier") ?? 1, RaidDamage.Fire);
  if (attacker === undefined || attacker === piece || !world.isAlive(attacker) || !(hasPlayerId(world, attacker) || world.has(attacker, PlayerIntent))) return amount;
  return amount * raidMul(defs, world.getField(piece, BuildPiece, "tier") ?? 1, raidKindOf(cause));
}

/**
 * Raid rule (ADR-104): wraps any rule already set via setRaidRule; additionally denies explosive damage to tiers
 * whose `raid.explosive` multiplier is 0. Idempotent per world.
 */
export function installBuildingRaidRule(world: World): void {
  const prev = world.getResource(RaidRuleRes)?.fn; if (prev && (prev as { modular?: true }).modular) return;
  const fn: RaidRule & { modular?: true } = (attacker, piece) => {
    if (prev && !prev(attacker, piece)) return false;
    return raidMul(gameplayDefs(world), world.getField(piece, BuildPiece, "tier") ?? 1, RaidDamage.Explosive) > 0;
  };
  fn.modular = true; setRaidRule(world, fn);
}
