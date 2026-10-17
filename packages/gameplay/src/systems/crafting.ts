/**
 * Crafting: IntentAction.Craft starts a timed job; IntentAction.CancelCraft cancels it.
 * Start validates recipe, station in range, ingredients, and that the output fits after the
 * ingredients are removed. Every tick the station must stay in range. On completion the inventory
 * exchange (consume ingredients + add output) is atomic and re-validated, so nothing is consumed
 * up-front and there is never anything to refund.
 * Deterministic and RNG-free: the client predicts it fully and reconciles.
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import { CraftingStation, Crafter, Dead, Fuel, IntentAction, Inventory, PlayerIntent } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks, StationKind, type RecipeDef } from "../defs.js";
import { CraftCompleted, CraftFail, CraftFailed, CraftStarted, emit } from "../events.js";
import { exchangeItems } from "../inventory.js";

/** Stations are looked up in the shared spatial index within this radius (>= any CraftingStation.range). */
export const MAX_STATION_RANGE = 4;
const FIRED = new Set<StationKind>([StationKind.Campfire, StationKind.Furnace]);
const near: Entity[] = [];

/** A station of `kind` within its range of e. Fired stations (campfire, furnace) must be lit. */
export function stationInRange(world: World, e: Entity, kind: StationKind): boolean {
  if (kind === StationKind.None) return true;
  const tf = world.store(Transform); const cs = world.store(CraftingStation);
  const a = tf.slot(entityIndex(e)); const x = tf.data.x[a]!, y = tf.data.y[a]!;
  near.length = 0;
  for (const st of installSpatialIndex(world).queryRadius(x, y, MAX_STATION_RANGE, near)) {
    const i = entityIndex(st); const s = cs.slot(i);
    if (s < 0 || cs.data.kind[s] !== kind || world.has(st, Dead)) continue;
    if (FIRED.has(kind) && !isLit(world, st)) continue;
    const b = tf.slot(i);
    if (Math.hypot(tf.data.x[b]! - x, tf.data.y[b]! - y) <= cs.data.range[s]!) return true;
  }
  return false;
}
/** Fired station is lit (Fuel.lit). */
export function isLit(world: World, e: Entity): boolean { return (world.getField(e, Fuel, "lit") ?? 0) !== 0; }

function checkRecipe(world: World, e: Entity, r: RecipeDef): CraftFail | 0 {
  if (!stationInRange(world, e, r.station)) return CraftFail.NoStation;
  if (!exchangeItems(world, e, r.ingredients, [], true)) return CraftFail.MissingIngredients;
  if (!exchangeItems(world, e, r.ingredients, [r.output], true)) return CraftFail.InventoryFull;
  return 0;
}

export function craftingSystem(world: World, dt: number): void {
  const defs = gameplayDefs(world);
  const intent = world.store(PlayerIntent); const cr = world.store(Crafter);
  for (const e of world.query([PlayerIntent, Crafter, Inventory, Transform], [Dead])) {
    const idx = entityIndex(e); const is = intent.slot(idx); const cs = cr.slot(idx);
    const action = intent.data.action[is]!;
    const current = cr.data.recipe[cs]!;
    const clear = (): void => { cr.data.recipe[cs] = 0; cr.data.startTick[cs] = 0; cr.data.totalTicks[cs] = 0; cr.markChanged(idx); };
    const fail = (recipe: number, reason: CraftFail): void => emit(world, CraftFailed, { entity: e, recipe, reason });

    if (action === IntentAction.CancelCraft && current !== 0) { clear(); fail(current, CraftFail.Cancelled); continue; }
    if (action === IntentAction.Craft) {
      const id = intent.data.recipe[is]!;
      if (current !== 0) { fail(id, CraftFail.Busy); continue; }
      const r = defs.recipes.get(id); if (!r) { fail(id, CraftFail.UnknownRecipe); continue; }
      const why = checkRecipe(world, e, r); if (why) { fail(id, why); continue; }
      const total = Math.min(0xffff, secondsToTicks(r.seconds, dt));
      cr.data.recipe[cs] = id; cr.data.startTick[cs] = world.tick + 1; cr.data.totalTicks[cs] = total; cr.markChanged(idx);
      emit(world, CraftStarted, { entity: e, recipe: id, totalTicks: total });
      continue; // progress starts next tick
    }
    if (current === 0) continue;
    const r = defs.recipes.get(current);
    if (!r) { clear(); fail(current, CraftFail.UnknownRecipe); continue; }
    if (!stationInRange(world, e, r.station)) { clear(); fail(current, CraftFail.NoStation); continue; }
    // progress is derived from startTick (no per-tick writes); the client predicts only this
    if (craftProgressTicks(world, e) + 1 < cr.data.totalTicks[cs]!) continue;
    if (!isAuthority(world)) continue; // the result lands by replication (owner-scoped Inventory) + reliable CraftCompleted
    const why = checkRecipe(world, e, r);
    clear();
    if (why) { fail(current, why); continue; }
    exchangeItems(world, e, r.ingredients, [r.output]);
    emit(world, CraftCompleted, { entity: e, recipe: current, item: r.output.item, count: r.output.count });
  }
}

/** Ticks of progress on the current job (0 if idle) = world.tick - startTick; UI: progress / totalTicks. */
export function craftProgressTicks(world: World, e: Entity, tick = world.tick): number {
  const c = world.get(e, Crafter); if (!c || !c.recipe) return 0;
  return Math.min(c.totalTicks, Math.max(0, tick - c.startTick));
}
