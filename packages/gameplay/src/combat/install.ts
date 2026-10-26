/** Combat + zombie systems and their place in the gameplay order. */
import type { World } from "@engine/core";
import { combatSystem, corpseSystem } from "./combat.js";
import { explosivesSystem, weaponsSystem } from "./arms.js";
import { viewBonusSystem } from "../net_hooks.js";
import { deathBagSystem, lootBagDespawnSystem } from "./pvp.js";
import { lootSummarySystem } from "../loot_labels.js";
import { burningSystem, contactSystem } from "./pvp_pieces.js";
import { defenseSystem } from "./defenses.js";
import { zombieAISystem, zombieSpawnerSystem } from "./zombies.js";

type Entry = readonly ["input" | "simulation" | "postSim", string, number?];
/** Spawner cadence = spawning.checkSeconds at 20 Hz (40 ticks). */
export const SPAWNER_EVERY = 40;
export const COMBAT_SYSTEMS: { sim: readonly Entry[]; postSim: readonly Entry[] } = {
  sim: [["simulation", "gameplay.weapons"], ["simulation", "gameplay.combat"], ["simulation", "gameplay.explosives"], ["simulation", "gameplay.zombieSpawner", SPAWNER_EVERY], ["simulation", "gameplay.zombieAI"], ["simulation", "gameplay.contact"], ["simulation", "gameplay.defenses"], ["simulation", "gameplay.burning"]],
  postSim: [["postSim", "gameplay.corpses"], ["postSim", "gameplay.lootBags", 20], ["postSim", "gameplay.lootSummary", 10], ["postSim", "gameplay.viewBonus", 10]],
};
export function installCombatSystems(_world: World): Record<string, (w: World, dt: number) => void> {
  return { "gameplay.weapons": weaponsSystem, "gameplay.explosives": explosivesSystem, "gameplay.combat": combatSystem, "gameplay.zombieSpawner": zombieSpawnerSystem, "gameplay.zombieAI": zombieAISystem, "gameplay.corpses": corpseSystem, "gameplay.contact": contactSystem, "gameplay.defenses": defenseSystem, "gameplay.burning": burningSystem, "gameplay.deathBags": deathBagSystem, "gameplay.lootBags": lootBagDespawnSystem, "gameplay.lootSummary": lootSummarySystem, "gameplay.viewBonus": viewBonusSystem };
}
