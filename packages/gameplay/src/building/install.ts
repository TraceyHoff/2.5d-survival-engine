/** Building systems + their place in the gameplay order (see install.ts GAMEPLAY_SYSTEM_ORDER). */
import type { World } from "@engine/core";
import { installEmitterIndex } from "@engine/world";
import { buildActionSystem, containerSystem, doorSystem, installDoorLookup } from "./actions.js";
import { ghostSystem } from "./ghost.js";
import { installStabilityRule, stabilitySystem, structureDamageSystem } from "./integrity.js";
import { structureOcclusion } from "./shelter.js";
import { structureIndexSystem, structures } from "./structure.js";

type Entry = readonly ["input" | "simulation" | "postSim", string, number?];
export const BUILDING_SYSTEMS: { pre: readonly Entry[]; actions: readonly Entry[]; post: readonly Entry[]; postSim: readonly Entry[] } = {
  pre: [["simulation", "gameplay.structureIndex"]],
  actions: [["simulation", "gameplay.build"], ["simulation", "gameplay.doors"], ["simulation", "gameplay.containers"]],
  post: [["simulation", "gameplay.structureDamage"], ["simulation", "gameplay.stability"]],
  postSim: [["postSim", "gameplay.ghost"]],
};

export function installBuildingSystems(world: World): Record<string, (w: World, dt: number) => void> {
  const idx = structures(world);
  installStabilityRule(world, idx); installDoorLookup(world);
  installEmitterIndex(world, { occlusion: structureOcclusion(world) });
  return {
    "gameplay.structureIndex": structureIndexSystem, "gameplay.build": buildActionSystem, "gameplay.doors": doorSystem,
    "gameplay.containers": containerSystem, "gameplay.structureDamage": structureDamageSystem, "gameplay.stability": stabilitySystem,
    "gameplay.ghost": ghostSystem,
  };
}
