/**
 * Diseases: shared helpers (data/diseases.json). This module is deliberately free of vitals imports: vitals.ts
 * calls contractDisease / cureDiseasesForItem from consumeSystem, while systems/diseases.ts owns the per-tick
 * system, the Boil action and transmission. Rolls happen at call sites, gated on isAuthority; contracting and
 * curing themselves are deterministic writes.
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { BuildPiece, CraftingStation, DamageCause, Diseases, Fuel, Health, MAX_DISEASES, Animal, Survival, Worn, Zombie } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { secondsToTicks, StationKind, WearSlot, type DiseaseDef } from "./defs.js";
import { Damaged } from "./events.js";
import { pieceOf } from "./building/links.js";

/** Adds a Diseases component when missing (same lazy pattern as writeBodyTemp); returns false when already present. */
export function ensureDiseases(world: World, e: Entity): boolean {
  if (world.has(e, Diseases)) return false;
  world.add(e, Diseases, {});
  return true;
}
/** Slot index holding disease `index` (0-based into defs.diseases), or -1. */
export function diseaseSlot(world: World, e: Entity, index: number): number {
  if (!world.has(e, Diseases)) return -1;
  const st = world.store(Diseases); const s = st.slot(entityIndex(e)); if (s < 0) return -1;
  for (let i = 0; i < MAX_DISEASES; i++) if (st.data.disease[s * MAX_DISEASES + i] === index + 1) return i;
  return -1;
}
export function hasDisease(world: World, e: Entity, key: string): boolean {
  const idx = gameplayDefs(world).diseaseIndex(key); return idx >= 0 && diseaseSlot(world, e, idx) >= 0;
}
/** Active disease defs on an entity (HUD chips, move penalty, transmission carriers). */
export function activeDiseases(world: World, e: Entity): DiseaseDef[] {
  if (!world.has(e, Diseases)) return [];
  const defs = gameplayDefs(world); const st = world.store(Diseases); const s = st.slot(entityIndex(e)); if (s < 0) return [];
  const out: DiseaseDef[] = [];
  for (let i = 0; i < MAX_DISEASES; i++) { const d = st.data.disease[s * MAX_DISEASES + i]!; if (d > 0) { const def = defs.diseases[d - 1]; if (def) out.push(def); } }
  return out;
}
/**
 * Contracts (or refreshes) a disease: expiry = now + duration (0 = no auto-expiry, e.g. exhaustion, which clears
 * on rest). Returns false for unknown keys or a full disease table.
 */
export function contractDisease(world: World, e: Entity, key: string, dt = 1 / 20): boolean {
  const defs = gameplayDefs(world); const idx = defs.diseaseIndex(key); if (idx < 0) return false;
  ensureDiseases(world, e);
  const st = world.store(Diseases); const s = st.slot(entityIndex(e)); if (s < 0) return false;
  const until = defs.diseases[idx]!.durationSeconds > 0 ? world.tick + secondsToTicks(defs.diseases[idx]!.durationSeconds, dt) : 0;
  let slot = diseaseSlot(world, e, idx);
  if (slot < 0) { for (let i = 0; i < MAX_DISEASES; i++) if (st.data.disease[s * MAX_DISEASES + i] === 0) { slot = i; break; } }
  if (slot < 0) return false;
  st.data.disease[s * MAX_DISEASES + slot] = idx + 1; st.data.untilTick[s * MAX_DISEASES + slot] = until; st.markChanged(entityIndex(e));
  return true;
}
/** Clears one disease; returns true when it was present. */
export function cureDisease(world: World, e: Entity, key: string): boolean {
  const idx = gameplayDefs(world).diseaseIndex(key); if (idx < 0 || !world.has(e, Diseases)) return false;
  const st = world.store(Diseases); const s = st.slot(entityIndex(e)); if (s < 0) return false;
  const slot = diseaseSlot(world, e, idx); if (slot < 0) return false;
  st.data.disease[s * MAX_DISEASES + slot] = 0; st.data.untilTick[s * MAX_DISEASES + slot] = 0; st.markChanged(entityIndex(e));
  return true;
}
/** Clears every disease the consumed item cures (consumeSystem calls this after a successful eat/drink). */
export function cureDiseasesForItem(world: World, e: Entity, item: number): string[] {
  const cured: string[] = [];
  for (const key of gameplayDefs(world).items.get(item)?.cures ?? []) if (cureDisease(world, e, key)) cured.push(key);
  return cured;
}
/** Combined walk-speed multiplier from active diseases (1 = healthy); multiplied into speedMultiplier. */
export function diseaseMoveMul(world: World, e: Entity): number {
  let m = 1; for (const d of activeDiseases(world, e)) m *= d.moveMul; return m;
}
/** True when the entity wears a mask item in the Accessory slot (blocks transmission in both directions). */
export function wearsMask(world: World, e: Entity): boolean {
  const w = world.get(e, Worn); const it = w?.item[WearSlot.Accessory] ?? 0;
  return it !== 0 && gameplayDefs(world).items.get(it)?.mask === true;
}
/**
 * True when a lit campfire is within `reach` tiles of (x, y): a Fuel-lit attachment whose piece is a campfire,
 * or a free-standing lit campfire station. Shared by the server Boil action and the client Boil button.
 */
export function nearLitCampfire(world: World, x: number, y: number, reach: number): boolean {
  const defs = gameplayDefs(world); const fu = world.store(Fuel); const r2 = reach * reach;
  for (let k = 0; k < fu.size; k++) {
    if (fu.data.lit[k] !== 1) continue;
    const fire = fu.dense[k]!; const t = world.get(fire, Transform); if (!t) continue;
    if ((t.x - x) ** 2 + (t.y - y) ** 2 > r2) continue;
    if (world.getField(fire, CraftingStation, "kind") === StationKind.Campfire) return true;
    const piece = pieceOf(world, fire); const type = piece === undefined ? undefined : world.getField(piece, BuildPiece, "type");
    if (type !== undefined && defs.pieces.get(type)?.station === StationKind.Campfire) return true;
  }
  return false;
}

const installed = new WeakSet<World>();
/**
 * Wound infection hook: zombie / animal bites roll infection. Subscribes once per world (called from
 * installGameplay); the Damaged event carries the real attacker entity, so no combat code changes are needed.
 * Events are discarded during replay, and only the authority rolls.
 */
export function installDiseases(world: World): void {
  if (installed.has(world)) return;
  installed.add(world);
  world.events.on(Damaged, (p: { target: Entity; source: Entity; cause: number }) => {
    if (!isAuthority(world) || p.cause !== DamageCause.Combat) return;
    const t = p.target, s = p.source;
    if (!world.isAlive(t) || !world.has(t, Survival) || !world.has(t, Health)) return;
    if (!world.isAlive(s) || (!world.has(s, Zombie) && !world.has(s, Animal))) return;
    ensureDiseases(world, t);
    const chance = gameplayDefs(world).diseaseTuning.causes.woundChance;
    if (chance > 0 && world.rngFor("disease.wound", t).next() < chance) contractDisease(world, t, "wound_infection");
  });
}
