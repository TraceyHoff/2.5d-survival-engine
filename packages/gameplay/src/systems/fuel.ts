/**
 * Fuel / burning (authority). Fire entities (campfire, furnace, torch) carry Fuel + Container (fuel slots) +
 * HeatSource. While lit, when burnUntilTick passes, one fuel item (items with fuelSeconds) is consumed from the
 * container; with nothing left the fire goes out. burnUntilTick is absolute, so steady burning writes nothing.
 * ToggleFire (range-checked) lights (needs fuel) or extinguishes. Fuel/HeatSource.lit replicate to all.
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { BuildPiece, Container, CraftingStation, Dead, Emitter, Fuel, IntentAction, PlayerIntent } from "../components.js";
import { emitterSpecs, EmitterKind } from "../realism.js";
import { gameplayDefs, isAuthority, rangeSlack } from "../config.js";
import { secondsToTicks, StationKind, type GameDefs } from "../defs.js";
import { BuildFail, BuildFailed, emit, ev, FireToggled, FuelOut } from "../events.js";
import { listSlots, removeItem } from "../inventory.js";
import { resolveAttachment } from "../building/links.js";
import { AttachKind } from "../components.js";
import { attachmentsOf, pieceOf } from "../building/links.js";

function burnNext(world: World, fire: Entity, defs: GameDefs, dt: number): boolean {
  if (!world.has(fire, Container)) return false;
  const mul = fuelMulOf(world, fire, defs);
  for (const s of listSlots(world, fire)) {
    const sec = defs.items.get(s.item)?.fuelSeconds ?? 0;
    if (sec > 0 && removeItem(world, fire, s.item, 1)) { world.setField(fire, Fuel, "burnUntilTick", world.tick + secondsToTicks(sec * mul, dt)); return true; }
  }
  return false;
}
/** Piece fuelMul (fireplace/wood_stove burn fuel slower); free-standing stations = 1. */
export function fuelMulOf(world: World, fire: Entity, defs: GameDefs): number {
  const piece = pieceOf(world, fire); const t = piece === undefined ? undefined : world.getField(piece, BuildPiece, "type");
  return (t === undefined ? undefined : defs.pieces.get(t)?.fuelMul) ?? 1;
}
/** ADR-108: a Snuffer (or anything) puts a lit fire / light out. Returns true if it was lit. */
export function snuffFire(world: World, fire: Entity, by: Entity = 0 as Entity): boolean {
  if (!world.has(fire, Fuel) || !world.getField(fire, Fuel, "lit")) return false;
  setLit(world, fire, 0); emit(world, LightSnuffed, { entity: fire, by }); return true;
}
export const LightSnuffed = ev<{ entity: Entity; by: Entity }>("gameplay.LightSnuffed");
/** Seconds of burn left on a fire: current item + every fuel item still in its Container (x fuelMul). */
export function fuelSecondsLeft(world: World, fire: Entity, dt = 1 / 20): number {
  const defs = gameplayDefs(world); const mul = fuelMulOf(world, fire, defs);
  let s = Math.max(0, (world.getField(fire, Fuel, "burnUntilTick") ?? 0) - world.tick) * dt;
  if (world.has(fire, Container)) for (const x of listSlots(world, fire)) s += (defs.items.get(x.item)?.fuelSeconds ?? 0) * x.count * mul;
  return s;
}
function setLit(world: World, fire: Entity, lit: number): void {
  world.setField(fire, Fuel, "lit", lit);
  setEmittersLit(world, fire, lit);
  emit(world, FireToggled, { entity: fire, lit });
}

export function fuelSystem(world: World, dt: number): void {
  if (!isAuthority(world)) return;
  const defs = gameplayDefs(world);
  // toggles
  const it = world.store(PlayerIntent);
  for (const e of world.query([PlayerIntent, Transform], [Dead])) {
    const s = it.slot(entityIndex(e)); if (it.data.action[s] !== IntentAction.ToggleFire) continue;
    const fire = resolveAttachment(world, it.data.target[s]!, AttachKind.Fire);
    const fail = (reason: BuildFail): void => emit(world, BuildFailed, { entity: e, action: IntentAction.ToggleFire, reason });
    if (fire === undefined || !world.has(fire, Fuel)) { fail(BuildFail.NotFuelable); continue; }
    if (distance(world, e, fire) > defs.building.containerReach + rangeSlack(world, e)) { fail(BuildFail.OutOfRange); continue; }
    if (world.getField(fire, Fuel, "lit")) { setLit(world, fire, 0); continue; }
    if (world.getField(fire, Fuel, "burnUntilTick")! > world.tick || burnNext(world, fire, defs, dt)) setLit(world, fire, 1);
    else fail(BuildFail.NotFuelable);
  }
  const fu = world.store(Fuel);
  for (let k = fu.size - 1; k >= 0; k--) {
    if (fu.data.lit[k] === 0 || fu.data.burnUntilTick[k]! > world.tick) continue;
    const fire = fu.dense[k]!;
    if (!burnNext(world, fire, defs, dt)) { setLit(world, fire, 0); emit(world, FuelOut, { entity: fire }); }
  }
}

export function distance(world: World, a: Entity, b: Entity): number {
  const tf = world.store(Transform); const sa = tf.slot(entityIndex(a)), sb = tf.slot(entityIndex(b));
  if (sa < 0 || sb < 0) return Infinity;
  return Math.hypot(tf.data.x[sa]! - tf.data.x[sb]!, tf.data.y[sa]! - tf.data.y[sb]!);
}

/**
 * Emitter strength follows Fuel.lit: lit -> full strength from piece data (realism emitterSpecs), unlit -> 0.
 * The fire entity carries the heat Emitter; a sibling light entity (AttachKind.Light) carries the light Emitter.
 */
export function setEmittersLit(world: World, fire: Entity, lit: number): void {
  const piece = pieceOf(world, fire);
  const targets = piece !== undefined ? attachmentsOf(world, piece).filter((a) => world.has(a, Emitter)) : world.has(fire, Emitter) ? [fire] : [];
  for (const t of targets) world.setField(t, Emitter, "strength", lit ? fullStrength(world, t, piece) : 0);
}
/** Free-standing stations (spawnStation): strength by station kind. */
export const STATION_HEAT: Readonly<Record<number, { strength: number; radius: number }>> = {
  [StationKind.Campfire]: { strength: 18, radius: 4 }, [StationKind.Furnace]: { strength: 10, radius: 2.5 },
};
function fullStrength(world: World, e: Entity, piece: Entity | undefined): number {
  const kind = world.getField(e, Emitter, "kind")!;
  if (piece !== undefined) {
    const t = world.getField(piece, BuildPiece, "type"); const def = t === undefined ? undefined : gameplayDefs(world).pieces.get(t);
    if (def) return emitterSpecs(def).find((x) => x.kind === kind)?.strength ?? 0;
  }
  return kind === EmitterKind.Heat ? STATION_HEAT[world.getField(e, CraftingStation, "kind") ?? 0]?.strength ?? 0 : 1;
}
