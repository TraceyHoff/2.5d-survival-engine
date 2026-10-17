/** Combat + zombie systems and their place in the gameplay order. */
import type { World } from "@engine/core";
import { combatSystem, corpseSystem } from "./combat.js";
import { zombieAISystem, zombieSpawnerSystem } from "./zombies.js";

type Entry = readonly ["input" | "simulation" | "postSim", string, number?];
/** Spawner cadence = spawning.checkSeconds at 20 Hz (40 ticks). */
export const SPAWNER_EVERY = 40;
export const COMBAT_SYSTEMS: { sim: readonly Entry[]; postSim: readonly Entry[] } = {
  sim: [["simulation", "gameplay.combat"], ["simulation", "gameplay.zombieSpawner", SPAWNER_EVERY], ["simulation", "gameplay.zombieAI"]],
  postSim: [["postSim", "gameplay.corpses"]],
};
export function installCombatSystems(_world: World): Record<string, (w: World, dt: number) => void> {
  return { "gameplay.combat": combatSystem, "gameplay.zombieSpawner": zombieSpawnerSystem, "gameplay.zombieAI": zombieAISystem, "gameplay.corpses": corpseSystem };
}
