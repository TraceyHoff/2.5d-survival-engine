/**
 * Crafting: IntentAction.Craft starts a timed job; IntentAction.CancelCraft cancels it.
 * Start validates recipe, station in range, ingredients, and that the output fits after the
 * ingredients are removed. Every tick the station must stay in range. On completion the inventory
 * exchange (consume ingredients + add output) is atomic and re-validated, so nothing is consumed
 * up-front and there is never anything to refund.
 * Deterministic and RNG-free: the client predicts it fully and reconciles.
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { CraftingStation, Crafter, Dead, IntentAction, Inventory, PlayerIntent } from "../components.js";
import { gameplayDefs } from "../config.js";
import { secondsToTicks, StationKind, type RecipeDef } from "../defs.js";
import { CraftCompleted, CraftFail, CraftFailed, CraftStarted } from "../events.js";
import { exchangeItems } from "../inventory.js";

export function stationInRange(world: World, e: Entity, kind: StationKind): boolean {
  if (kind === StationKind.None) return true;
  const tf = world.store(Transform); const cs = world.store(CraftingStation);
  const a = tf.slot(entityIndex(e)); const x = tf.data.x[a]!, y = tf.data.y[a]!;
  for (const st of world.query([CraftingStation, Transform], [Dead])) {
    const i = entityIndex(st); const s = cs.slot(i);
    if (cs.data.kind[s] !== kind) continue;
    const b = tf.slot(i);
    if (Math.hypot(tf.data.x[b]! - x, tf.data.y[b]! - y) <= cs.data.range[s]!) return true;
  }
  return false;
}

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
    const clear = (): void => { cr.data.recipe[cs] = 0; cr.data.progressTicks[cs] = 0; cr.data.totalTicks[cs] = 0; cr.markChanged(idx); };
    const fail = (recipe: number, reason: CraftFail): void => world.events.emit(CraftFailed, { entity: e, recipe, reason });

    if (action === IntentAction.CancelCraft && current !== 0) { clear(); fail(current, CraftFail.Cancelled); continue; }
    if (action === IntentAction.Craft) {
      const id = intent.data.recipe[is]!;
      if (current !== 0) { fail(id, CraftFail.Busy); continue; }
      const r = defs.recipes.get(id); if (!r) { fail(id, CraftFail.UnknownRecipe); continue; }
      const why = checkRecipe(world, e, r); if (why) { fail(id, why); continue; }
      const total = Math.min(0xffff, secondsToTicks(r.seconds, dt));
      cr.data.recipe[cs] = id; cr.data.progressTicks[cs] = 0; cr.data.totalTicks[cs] = total; cr.markChanged(idx);
      world.events.emit(CraftStarted, { entity: e, recipe: id, totalTicks: total });
      continue; // progress starts next tick
    }
    if (current === 0) continue;
    const r = defs.recipes.get(current);
    if (!r) { clear(); fail(current, CraftFail.UnknownRecipe); continue; }
    if (!stationInRange(world, e, r.station)) { clear(); fail(current, CraftFail.NoStation); continue; }
    const progress = cr.data.progressTicks[cs]! + 1;
    cr.data.progressTicks[cs] = progress; cr.markChanged(idx);
    if (progress < cr.data.totalTicks[cs]!) continue;
    const why = checkRecipe(world, e, r);
    clear();
    if (why) { fail(current, why); continue; }
    exchangeItems(world, e, r.ingredients, [r.output]);
    world.events.emit(CraftCompleted, { entity: e, recipe: current, item: r.output.item, count: r.output.count });
  }
}
