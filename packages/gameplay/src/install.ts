import { DEFAULT_TICK_HZ, entityIndex, Owner, TimeOfDay, Transform, Weather, WeatherKind, type Entity, type World } from "@engine/core";
import {
  CraftingStation, Crafter, Equipment, Exposure, GAMEPLAY_COMPONENTS, Gatherer, Health, HeatSource, IntentAction,
  Inventory, NO_SLOT, PlayerIntent, ResourceNode, Survival, VitalsModifiers, VitalsState,
} from "./components.js";
import { GameplayConfig, gameplayDefs, type GameplayRole } from "./config.js";
import { defaultDefs } from "./data.js";
import { StationKind, type GameDefs } from "./defs.js";
import { slotItem } from "./inventory.js";
import { clockSystem, exposureSystem, weatherSystem } from "./systems/environment.js";
import { craftingSystem } from "./systems/crafting.js";
import { gatherSystem, respawnSystem } from "./systems/gathering.js";
import { consumeSystem, deathSystem, vitalsSystem } from "./systems/vitals.js";

export interface GameplayOptions {
  defs?: GameDefs;
  role?: GameplayRole;
  /** Overrides environment.json dayLengthSeconds. */
  dayLengthTicks?: number;
  tickHz?: number;
  /** Set false if another package (or replication) owns TimeOfDay / Weather. */
  driveClock?: boolean;
  driveWeather?: boolean;
}

/** System order. Exported so DESIGN.md / tests / tooling can assert it. */
export const GAMEPLAY_SYSTEM_ORDER = [
  ["simulation", "gameplay.clock"],
  ["simulation", "gameplay.weather"],
  ["simulation", "gameplay.exposure"],
  ["simulation", "gameplay.respawn"],
  ["simulation", "gameplay.gather"],
  ["simulation", "gameplay.craft"],
  ["simulation", "gameplay.consume"],
  ["simulation", "gameplay.vitals"],
  ["simulation", "gameplay.death"],
  ["simulation", "gameplay.clearIntents"],
  ["postSim", "gameplay.equipmentSync"],
] as const;

/**
 * Registers gameplay components (fixed order, identical on client and server), resources and systems.
 * Second argument may be a number for backwards compatibility with the stub (dayLengthTicks).
 */
export function installGameplay(world: World, options: GameplayOptions | number = {}): void {
  const opts: GameplayOptions = typeof options === "number" ? { dayLengthTicks: options } : options;
  const defs = opts.defs ?? defaultDefs();
  const env = defs.environment;
  for (const c of GAMEPLAY_COMPONENTS) world.register(c);
  world.setResource(GameplayConfig, { defs, role: opts.role ?? "standalone" });
  const dayLengthTicks = opts.dayLengthTicks ?? Math.round(env.dayLengthSeconds * (opts.tickHz ?? DEFAULT_TICK_HZ));
  if (!world.getResource(TimeOfDay)) world.setResource(TimeOfDay, { t: env.startTimeOfDay, dayLengthTicks, day: 0 });
  if (!world.getResource(Weather)) world.setResource(Weather, { kind: WeatherKind.Clear, intensity: 0, ticksRemaining: 0 });

  if (opts.driveClock !== false) world.addSystem("simulation", "gameplay.clock", clockSystem);
  if (opts.driveWeather !== false) world.addSystem("simulation", "gameplay.weather", weatherSystem);
  world.addSystem("simulation", "gameplay.exposure", exposureSystem);
  world.addSystem("simulation", "gameplay.respawn", respawnSystem);
  world.addSystem("simulation", "gameplay.gather", gatherSystem);
  world.addSystem("simulation", "gameplay.craft", craftingSystem);
  world.addSystem("simulation", "gameplay.consume", consumeSystem);
  world.addSystem("simulation", "gameplay.vitals", vitalsSystem);
  world.addSystem("simulation", "gameplay.death", deathSystem);
  world.addSystem("simulation", "gameplay.clearIntents", clearIntentsSystem);
  world.addSystem("postSim", "gameplay.equipmentSync", equipmentSyncSystem);
}

/** One-shot actions are consumed at the end of the simulation phase (so simulate() replays are correct). */
export function clearIntentsSystem(world: World): void {
  const st = world.store(PlayerIntent);
  for (let k = 0; k < st.size; k++) {
    if (st.data.action[k] !== IntentAction.None) { st.data.action[k] = IntentAction.None; st.markChanged(entityIndex(st.dense[k]!)); }
  }
}

/** Derives Equipment.mainHandItem (networked to all) from the owner-only inventory. */
export function equipmentSyncSystem(world: World): void {
  for (const e of world.query([Equipment, Inventory])) {
    const slot = world.getField(e, Equipment, "mainHandSlot")!;
    const item = slot === NO_SLOT ? 0 : slotItem(world, e, slot).item;
    if (world.getField(e, Equipment, "mainHandItem") !== item) world.setField(e, Equipment, "mainHandItem", item);
  }
}

// ---- spawn helpers (server spawns; NetId assignment is @engine/net's job) ----------------------

export interface PlayerSpawn { x: number; y: number; clientId?: number; slots?: number; maxWeight?: number; reach?: number }
export function spawnPlayer(world: World, p: PlayerSpawn): Entity {
  const vt = gameplayDefs(world).vitals; const e = world.create();
  world.add(e, Transform, { x: p.x, y: p.y })
    .add(e, Health, { hp: vt.maxHealth, max: vt.maxHealth })
    .add(e, Survival, { hunger: 100, thirst: 100, stamina: vt.maxStamina, maxStamina: vt.maxStamina, bodyTemp: vt.bodyTempNormal })
    .add(e, VitalsState).add(e, VitalsModifiers, { hungerMul: 1, thirstMul: 1, staminaRegenMul: 1 })
    .add(e, Exposure, { feltTemp: 20 })
    .add(e, Inventory, { slotCount: p.slots ?? 16, maxWeight: p.maxWeight ?? 60 })
    .add(e, Equipment, { mainHandSlot: NO_SLOT })
    .add(e, Gatherer, { reach: p.reach ?? 1.5 })
    .add(e, Crafter).add(e, PlayerIntent);
  if (p.clientId !== undefined) world.add(e, Owner, { clientId: p.clientId });
  return e;
}

export function spawnResourceNode(world: World, kind: number | string, x: number, y: number): Entity {
  const defs = gameplayDefs(world);
  const id = typeof kind === "string" ? defs.resourceId(kind) : kind;
  const def = defs.resources.get(id); if (!def) throw new Error(`unknown resource ${kind}`);
  const e = world.create();
  world.add(e, Transform, { x, y }).add(e, ResourceNode, { kind: id, amount: def.capacity });
  return e;
}

export function spawnStation(world: World, kind: StationKind, x: number, y: number, range = 2.5): Entity {
  const e = world.create();
  world.add(e, Transform, { x, y }).add(e, CraftingStation, { kind, range });
  if (kind === StationKind.Campfire) world.add(e, HeatSource, { heat: 18, radius: 4, lit: 1 });
  return e;
}

/** Input-phase adapter helper: writes a player's intent for this tick. */
export function setIntent(world: World, e: Entity, intent: Partial<{ moving: number; sprint: number; action: IntentAction; target: Entity; recipe: number; slot: number }>): void {
  world.set(e, PlayerIntent, intent);
}
