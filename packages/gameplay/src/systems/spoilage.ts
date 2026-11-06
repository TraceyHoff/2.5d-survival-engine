/**
 * Spoilage (authority, slow system every 20 ticks): food freshness is lazy (core decayAt from each slot's effective
 * created tick), so nothing ticks per item. This system only
 *  1. re-bases created ticks when a holder's spoil multiplier changes (temperature x container), preserving freshness;
 *  2. converts fully spoiled stacks to the spoiled item (data: environment.spoilage.spoiledItem).
 * Multiplier = container spoilMul (piece data) x clamp(1 + mulPerDegree x (temp - tempRefC), minMul, maxMul).
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { BuildPiece, Container, Exposure, Inventory, type InvSchema } from "../components.js";
import { pieceOf } from "../building/links.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { countItem, freshness, listSlots, mapSlots, rebaseCreated, removeItem, slotsAdd } from "../inventory.js";
import { pendingReady } from "../ready.js";
import { ambientTemperature } from "./environment.js";
import type { ComponentDef } from "@engine/core";

export const SPOILAGE_EVERY = 20;
/** Task 28: a salt-fuelled container burns 1 salt per SALT_CONSUME_TICKS while it holds spoilable food. */
export const SALT_CONSUME_TICKS = 3600;
/** Last tick each salt-fuelled container consumed salt (authority-side only; resets on reload — timing, not state). */
const saltLast = new WeakMap<World, Map<Entity, number>>();
/** Salt in a container holder (0 when the holder has no salt item, or the catalog has no salt). */
export function saltCount(world: World, e: Entity): number {
  let salt = 0; try { salt = gameplayDefs(world).itemId("salt"); } catch { return 0; }
  return countItem(world, e, salt);
}
/** Container multiplier from the owning piece's data (1 for players / free-standing holders). Task 28: a
 * salt-fuelled piece (salt_barrel / curing_box / cold_store) only grants its spoilMul while its container
 * holds salt; unfuelled it is ordinary storage (multiplier 1). */
function baseMul(world: World, e: Entity): number {
  const p = pieceOf(world, e); if (p === undefined) return 1;
  const t = world.getField(p, BuildPiece, "type"); const def = t !== undefined ? gameplayDefs(world).pieces.get(t) : undefined;
  if (!def) return 1;
  if (def.saltFuel) return saltCount(world, e) > 0 ? def.spoilMul : 1;
  return def.spoilMul || 1;
}
/** Does this container hold any spoilable food? (Salt only burns while there is food to preserve.) */
function holdsSpoilable(world: World, e: Entity): boolean {
  const defs = gameplayDefs(world);
  for (const s of listSlots(world, e)) if (s.item && s.count && defs.items.get(s.item)?.spoilSeconds) return true;
  return false;
}
/** Burn one salt from a salt-fuelled container when due (called from the Container pass, before `want` is read). */
function burnSalt(world: World, e: Entity): void {
  const p = pieceOf(world, e); if (p === undefined) return;
  const t = world.getField(p, BuildPiece, "type"); const def = t !== undefined ? gameplayDefs(world).pieces.get(t) : undefined;
  if (!def?.saltFuel) return;
  if (!holdsSpoilable(world, e) || saltCount(world, e) <= 0) return;
  let m = saltLast.get(world); if (!m) saltLast.set(world, (m = new Map()));
  const last = m.get(e);
  if (last === undefined) { m.set(e, world.tick); return; } // first sight: start the clock, do not burn yet
  if (world.tick - last < SALT_CONSUME_TICKS) return;
  if (removeItem(world, e, gameplayDefs(world).itemId("salt"), 1)) m.set(e, world.tick);
}

export function spoilageSystem(world: World, dt: number): void {
  if (!isAuthority(world)) return;
  const defs = gameplayDefs(world); const sp = defs.environment.spoilage; const tickDt = dt / SPOILAGE_EVERY;
  const run = (def: ComponentDef<InvSchema>): void => {
    const st = world.store(def);
    for (let k = st.size - 1; k >= 0; k--) {
      const e = st.dense[k]!; if (pendingReady(world, e)) continue; // Task 14: a loading player's pack does not spoil
      if (def === Container) burnSalt(world, e); // Task 28: salt burns before the multiplier is read this pass
      const idx = entityIndex(e);
      const temp = world.has(e, Exposure) ? world.getField(e, Exposure, "feltTemp")! : world.has(e, Transform) ? ambientTemperature(world, world.getField(e, Transform, "x")!, world.getField(e, Transform, "y")!) : sp.tempRefC;
      const tempMul = Math.min(sp.maxMul, Math.max(sp.minMul, 1 + sp.mulPerDegree * (temp - sp.tempRefC)));
      const want = baseMul(world, e) * tempMul; const cur = st.data.spoilMul[k]!;
      const rebase = Math.abs(want - cur) > sp.rebaseThreshold * cur;
      mapSlots(world, e, (v) => {
        let changed = false;
        for (let i = 0; i < v.slotCount; i++) {
          const item = v.item(i); if (!item || !(defs.items.get(item)?.spoilSeconds)) continue;
          if (rebase) { v.put(i, item, v.count(i), rebaseCreated(v.created(i), world.tick, cur, want)); changed = true; }
          if (freshness(defs, item, v.created(i), rebase ? want : cur, world.tick, tickDt) <= 0 && defs.spoiledItem) {
            const n = v.count(i); v.put(i, 0, 0); slotsAdd(v, defs.spoiledItem, n, defs, world.tick); changed = true;
          }
        }
        return changed;
      });
      if (rebase) { st.data.spoilMul[st.slot(idx)] = want; st.markChanged(idx); }
    }
  };
  run(Inventory); run(Container);
}
