/**
 * Character customization rules (docs/CHARACTER_CUSTOMIZATION.md; core Appearance / validateAppearance / setAppearance).
 * Gameplay owns: the gameplay.setAppearance command, per-player unlock tags (Wardrobe.unlocks, data-driven grants), and
 * the edit gate (first-join creator once, then only near a piece with features.wardrobe). All writes go through core
 * setAppearance. Netcode's AppearanceServer plugs in via appearanceServerHooks (unlocksOf / allow / onChanged).
 */
import {
  Appearance, defineCommand, defineResource, PlayerId, entityIndex, getAppearance, SLOT_COUNT, setAppearance, Transform, validateAppearance,
  type AppearanceValue, type CommandHandlers, type CosmeticCatalogLike, type Entity, type World,
} from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import raw from "../data/cosmetics.json";
import { BuildPiece, StallOwnerKind, Wardrobe } from "./components.js";
import { StallSale } from "./economy/stall.js";
import { hasPlayerId } from "./combat/pvp.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { CraftCompleted } from "./events.js";

export type UnlockOn = "firstJoin" | "craft" | "stallSale" | "raidBreach";
export interface UnlockRule { readonly tag: string; readonly on: UnlockOn; readonly recipe?: string }
export interface CosmeticsConfig { readonly unlockTags: readonly string[]; readonly rules: readonly UnlockRule[]; readonly wardrobeRange: number }
export const COSMETICS: CosmeticsConfig = Object.freeze(raw as unknown as CosmeticsConfig);
if (COSMETICS.unlockTags.length > 64) throw new Error("cosmetics.json: at most 64 unlockTags");
for (const r of COSMETICS.rules) if (!COSMETICS.unlockTags.includes(r.tag)) throw new Error(`cosmetics.json: rule tag "${r.tag}" not in unlockTags`);

export interface CustomizationRes { catalog: CosmeticCatalogLike }
export const Customization = defineResource<CustomizationRes>("gameplay.Customization");

const ensure = (world: World, e: Entity): void => { if (!world.has(e, Wardrobe)) world.add(e, Wardrobe); };
// ---- unlocks -----------------------------------------------------------------------------------
export function unlocksOf(world: World, e: Entity): ReadonlySet<string> {
  const a = world.getArray(e, Wardrobe, "unlocks"); const out = new Set<string>(); if (!a) return out;
  COSMETICS.unlockTags.forEach((t, i) => { if ((a[i >> 5]! >>> (i & 31)) & 1) out.add(t); }); return out;
}
export const hasUnlock = (world: World, e: Entity, tag: string): boolean => unlocksOf(world, e).has(tag);
/** Grants a tag (authority). Returns true when newly granted. Unknown tags throw (data bug). */
export function grantUnlock(world: World, e: Entity, tag: string): boolean {
  const i = COSMETICS.unlockTags.indexOf(tag); if (i < 0) throw new Error(`unknown unlock tag ${tag}`);
  if (!world.isAlive(e)) return false; ensure(world, e);
  const a = world.getArray(e, Wardrobe, "unlocks")!; const bit = (1 << (i & 31)) >>> 0;
  if (a[i >> 5]! & bit) return false; a[i >> 5] = (a[i >> 5]! | bit) >>> 0; world.store(Wardrobe).markChanged(entityIndex(e)); return true;
}
function grantFor(world: World, e: Entity, on: UnlockOn, recipe?: string): void {
  for (const r of COSMETICS.rules) if (r.on === on && (r.recipe === undefined || r.recipe === recipe)) grantUnlock(world, e, r.tag);
}
/** Hooks for other systems (stall sale seller, raid breach attacker). Authority only; no-ops while replaying. */
export function noteUnlockEvent(world: World, e: Entity, on: UnlockOn, recipe?: string): void {
  if (!isAuthority(world) || world.isReplaying) return; grantFor(world, e, on, recipe);
}

// ---- edit gate ---------------------------------------------------------------------------------
export const hasCreatedLook = (world: World, e: Entity): boolean => world.getField(e, Wardrobe, "created") === 1;
const near: Entity[] = [];
/** A piece with features.wardrobe within cosmetics.wardrobeRange of e. */
export function nearWardrobe(world: World, e: Entity): boolean {
  const t = world.get(e, Transform); if (!t) return false; const defs = gameplayDefs(world);
  near.length = 0;
  for (const p of installSpatialIndex(world).queryRadius(t.x, t.y, COSMETICS.wardrobeRange, near)) {
    const type = world.getField(p, BuildPiece, "type"); if (type === undefined || !defs.pieces.get(type)?.features.wardrobe) continue;
    const q = world.get(p, Transform)!; if (Math.hypot(q.x - t.x, q.y - t.y) <= COSMETICS.wardrobeRange) return true;
  }
  return false;
}
/** Game rule: the first-join creator once (initial and not yet created), afterwards only at a mirror/wardrobe. */
export function canEditAppearance(world: World, e: Entity, initial: boolean): boolean {
  if (!hasCreatedLook(world, e)) return true;
  return !initial && nearWardrobe(world, e);
}

// ---- writes --------------------------------------------------------------------------------------
export type AppearanceReject = "no_catalog" | "not_allowed" | string;
function catalogOf(world: World): CosmeticCatalogLike | undefined { return world.getResource(Customization)?.catalog; }
/** Marks the creator done and grants firstJoin rules (call after any successful write, incl. net's onChanged). */
export function onAppearanceChanged(world: World, e: Entity): void {
  ensure(world, e); if (hasCreatedLook(world, e)) return;
  world.setField(e, Wardrobe, "created", 1); if (!world.isReplaying) grantFor(world, e, "firstJoin");
}
/** Server: validate (reject mode, player's unlocks) + gate, then core setAppearance. Returns a reason or undefined. */
export function checkAppearance(world: World, e: Entity, value: Partial<AppearanceValue>, initial = !hasCreatedLook(world, e)): { reason?: AppearanceReject; value?: AppearanceValue } {
  const cat = catalogOf(world); if (!cat) return { reason: "no_catalog" };
  if (!canEditAppearance(world, e, initial)) return { reason: "not_allowed" };
  const v = validateAppearance(cat, value, { mode: "reject", unlocked: unlocksOf(world, e) });
  if (v.issues.length || !v.value) return { reason: v.issues[0] ?? "invalid" };
  return { value: v.value };
}
export function applyAppearance(world: World, e: Entity, value: Partial<AppearanceValue>, initial = !hasCreatedLook(world, e)): AppearanceReject | undefined {
  const r = checkAppearance(world, e, value, initial); if (!r.value) return r.reason;
  setAppearance(world, e, r.value); onAppearanceChanged(world, e); return undefined;
}
/** Optional single-slot equip (e.g. from a cosmetic item / wardrobe UI): same gate + validation. */
function equipped(world: World, e: Entity, slot: number, wearable: number, primary?: number, secondary?: number): AppearanceValue | string {
  const cur = getAppearance(world, e); if (!cur) return "no_appearance"; if (!(slot >= 0 && slot < SLOT_COUNT)) return "bad_slot";
  const next: AppearanceValue = { bodyType: cur.bodyType, skinTone: cur.skinTone, parts: [...cur.parts], primary: [...cur.primary], secondary: [...cur.secondary] };
  next.parts[slot] = wearable; if (primary !== undefined) next.primary[slot] = primary; if (secondary !== undefined) next.secondary[slot] = secondary;
  return next;
}
export function equipCosmetic(world: World, e: Entity, slot: number, wearable: number, primary?: number, secondary?: number): AppearanceReject | undefined {
  const n = equipped(world, e, slot, wearable, primary, secondary); return typeof n === "string" ? n : applyAppearance(world, e, n, false);
}

// ---- command + install -------------------------------------------------------------------------------
export const SetAppearanceCmd = defineCommand("gameplay.setAppearance", {
  bodyType: "u8", skinTone: "u8", parts: { type: "u16", length: SLOT_COUNT }, primary: { type: "u8", length: SLOT_COUNT }, secondary: { type: "u8", length: SLOT_COUNT },
});
export const EquipCosmeticCmd = defineCommand("gameplay.equipCosmetic", { slot: "u8", wearable: "u16", primary: "u8", secondary: "u8" });
export const CUSTOMIZATION_COMMANDS = [SetAppearanceCmd, EquipCosmeticCmd] as const;

/**
 * Server: stores the catalog, grants craft-rule unlocks from CraftCompleted, and (given core handlers) handles the
 * commands. Pass the same functions to Netcode's AppearanceServer via appearanceServerHooks.
 */
export function installCustomization(world: World, opts: { catalog: CosmeticCatalogLike; handlers?: CommandHandlers }): void {
  if (!world.isRegistered(Appearance)) world.register(Appearance);
  world.setResource(Customization, { catalog: opts.catalog });
  const defs = gameplayDefs(world);
  world.events.on(CraftCompleted, (p: { entity: Entity; recipe: number }) => noteUnlockEvent(world, p.entity, "craft", defs.recipes.get(p.recipe)?.key));
  // stall sales: the selling player (player-owned stalls, owner online) earns stallSale tags
  world.events.on(StallSale, (p: { ownerKind: number; ownerId: number }) => { if (p.ownerKind !== StallOwnerKind.Player) return;
    if (!world.isRegistered(PlayerId)) return;
    for (const e of world.query([PlayerId])) if ((hasPlayerId(world, e) ? world.getField(e, PlayerId, "id") : undefined) === p.ownerId) { noteUnlockEvent(world, e, "stallSale"); break; } });
  const h = opts.handlers; if (!h) return;
  const fromCmd = (v: { bodyType: number; skinTone: number; parts: ArrayLike<number>; primary: ArrayLike<number>; secondary: ArrayLike<number> }): AppearanceValue =>
    ({ bodyType: v.bodyType, skinTone: v.skinTone, parts: Array.from(v.parts), primary: Array.from(v.primary), secondary: Array.from(v.secondary) });
  h.on(SetAppearanceCmd, {
    validate: (v, ctx) => checkAppearance(world, ctx.actor, fromCmd(v)).reason,
    handle: (v, ctx) => { applyAppearance(world, ctx.actor, fromCmd(v)); },
  });
  h.on(EquipCosmeticCmd, {
    validate: (v, ctx) => { const n = equipped(world, ctx.actor, v.slot, v.wearable, v.primary, v.secondary); return typeof n === "string" ? n : checkAppearance(world, ctx.actor, n, false).reason; },
    handle: (v, ctx) => { equipCosmetic(world, ctx.actor, v.slot, v.wearable, v.primary, v.secondary); },
  });
}
/** Structural match for @engine/net AppearanceServerOptions (gameplay does not import net). */
export function appearanceServerHooks(world: World, markDirty?: (e: Entity) => void) {
  return {
    unlocksOf: (_s: unknown, e: Entity) => unlocksOf(world, e),
    allow: (_s: unknown, e: Entity, initial: boolean) => canEditAppearance(world, e, initial),
    onChanged: (_s: unknown, e: Entity) => { onAppearanceChanged(world, e); markDirty?.(e); },
  };
}
