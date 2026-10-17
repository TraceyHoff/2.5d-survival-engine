import { DEFAULT_TICK_HZ, pruneModifiers, setTimeOfDay, TimeOfDay, Weather, type World } from "@engine/core";
import { installSpatialIndex, setClimateModel, ClimateRes } from "@engine/world";
import { Buffs, Equipment, GAMEPLAY_COMPONENTS, IntentAction, Inventory, NO_SLOT, PlayerIntent } from "./components.js";
import { GameplayConfig, type GameplayRole } from "./config.js";
import { defaultDefs } from "./data.js";
import { WeatherKind, type GameDefs } from "./defs.js";
import { commandIntentSystem } from "./input.js";
import { slotItem } from "./inventory.js";
import { applyReplication, type NetReplicationHooks } from "./replication.js";
import { chunkSurfaceSystem, clockSystem, exposureSystem, EXPOSURE_EVERY, gameplayClimateModel, SURFACE_EVERY, weatherSystem } from "./systems/environment.js";
import { craftingSystem } from "./systems/crafting.js";
import { fuelSystem } from "./systems/fuel.js";
import { gatherSystem, respawnSystem } from "./systems/gathering.js";
import { noiseDecaySystem } from "./systems/noise.js";
import { spoilageSystem, SPOILAGE_EVERY } from "./systems/spoilage.js";
import { consumeSystem, deathSystem, vitalsSystem } from "./systems/vitals.js";
import { installBuildingSystems, BUILDING_SYSTEMS } from "./building/install.js";
import { installCombatSystems, COMBAT_SYSTEMS } from "./combat/install.js";
import { entityIndex } from "@engine/core";

export * from "./spawn.js";

export interface GameplayOptions {
  defs?: GameDefs;
  role?: GameplayRole;
  /** Overrides environment.json dayLengthSeconds. */
  dayLengthTicks?: number;
  tickHz?: number;
  /** Server role: the NetServer (structurally) - BuildPiece is registered as static class and scopes applied. Call before clients join. */
  net?: NetReplicationHooks;
}

type Phase = "input" | "simulation" | "postSim";
/** System order (gameplay systems only; third element = every N ticks). Tests assert world.systemOrder() matches. */
export const GAMEPLAY_SYSTEM_ORDER: readonly (readonly [Phase, string, number?])[] = [
  ["input", "gameplay.commands"],
  ["simulation", "gameplay.clock"],
  ["simulation", "gameplay.weather"],
  ...BUILDING_SYSTEMS.pre,
  ["simulation", "gameplay.exposure", EXPOSURE_EVERY],
  ["simulation", "gameplay.fuel"],
  ["simulation", "gameplay.respawn"],
  ["simulation", "gameplay.gather"],
  ...BUILDING_SYSTEMS.actions,
  ["simulation", "gameplay.craft"],
  ...COMBAT_SYSTEMS.sim,
  ...BUILDING_SYSTEMS.post,
  ["simulation", "gameplay.consume"],
  ["simulation", "gameplay.vitals"],
  ["simulation", "gameplay.death"],
  ["simulation", "gameplay.spoilage", SPOILAGE_EVERY],
  ["simulation", "gameplay.chunkSurface", SURFACE_EVERY],
  ["simulation", "gameplay.clearIntents"],
  ["postSim", "gameplay.equipmentSync"],
  ...BUILDING_SYSTEMS.postSim,
  ...COMBAT_SYSTEMS.postSim,
  ["postSim", "gameplay.noiseDecay"],
  ["postSim", "gameplay.pruneBuffs", 20],
];

/** Registers gameplay components (the shared registration module: fixed order on every peer), resources and systems. */
export function installGameplay(world: World, options: GameplayOptions | number = {}): void {
  const opts: GameplayOptions = typeof options === "number" ? { dayLengthTicks: options } : options;
  const defs = opts.defs ?? defaultDefs();
  const env = defs.environment;
  for (const c of GAMEPLAY_COMPONENTS) world.register(c);
  world.addSchemaSalt("gameplay.defs", defs.hashes.all);
  const role = opts.role ?? "standalone";
  world.setResource(GameplayConfig, { defs, role });
  const dayLengthTicks = opts.dayLengthTicks ?? Math.round(env.dayLengthSeconds * (opts.tickHz ?? DEFAULT_TICK_HZ));
  // Environment singleton is created by core; initialise TimeOfDay once (dayLengthTicks 0 = uninitialised).
  if (world.env(TimeOfDay).dayLengthTicks === 0) { world.env(TimeOfDay).dayLengthTicks = dayLengthTicks; setTimeOfDay(world, env.startTimeOfDay * 24, 0); }
  world.set(world.environment, Weather, { kind: WeatherKind.Clear });
  installSpatialIndex(world);
  if (world.getResource(ClimateRes)) setClimateModel(world, gameplayClimateModel(env));
  if (opts.net && role === "server") applyReplication(opts.net);

  const sys: Record<string, (w: World, dt: number) => void> = {
    "gameplay.commands": commandIntentSystem, "gameplay.clock": clockSystem, "gameplay.weather": weatherSystem,
    "gameplay.exposure": exposureSystem, "gameplay.fuel": fuelSystem, "gameplay.respawn": respawnSystem, "gameplay.gather": gatherSystem,
    "gameplay.craft": craftingSystem, "gameplay.consume": consumeSystem, "gameplay.vitals": vitalsSystem, "gameplay.death": deathSystem,
    "gameplay.spoilage": spoilageSystem, "gameplay.chunkSurface": chunkSurfaceSystem,
    "gameplay.clearIntents": clearIntentsSystem, "gameplay.equipmentSync": equipmentSyncSystem, "gameplay.noiseDecay": noiseDecaySystem,
    "gameplay.pruneBuffs": (w) => pruneModifiers(w, Buffs),
    ...installBuildingSystems(world), ...installCombatSystems(world),
  };
  for (const [phase, name, every] of GAMEPLAY_SYSTEM_ORDER) {
    const fn = sys[name]; if (!fn) throw new Error(`no system ${name}`);
    world.addSystem(phase, name, fn, every ? { every } : {});
  }
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

