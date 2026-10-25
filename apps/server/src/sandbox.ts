/**
 * ADR-140 dev sandbox (test/QA only; never on in normal play): every joining player gets a building / crafting /
 * gear / food kit and spawns next to the other players (a fixed spot = the "dev teleport" that puts clients side by
 * side for party / trade / clan tests). Enabled by `?dev=sandbox` (singleplayer, own save slot) or DEV_SANDBOX=1 (server).
 */
import type { World, Entity } from "@engine/core";
import { addItem, itemIdSafe } from "@engine/gameplay";

/** Kit sized to fit the 16-slot / weight-capped starting inventory: gear, food, campfire + workbench + anvil, twig build, gravel road, sign. */
export const SANDBOX_KIT: readonly (readonly [string, number])[] = [
  ["iron_helmet", 1], ["leather_jacket", 1], ["leather_trousers", 1], ["leather_boots", 1], ["iron_sword", 1], ["stone_shovel", 1],
  ["cooked_meat", 5], ["water_flask", 1],
  ["wood", 16], ["stone", 10], ["sticks", 24], ["gravel", 10], ["sign_wooden_post", 2], ["iron_ingot", 6], ["hardwood", 2], ["planks", 4],
];

/** Gives the kit; returns the keys that were (partly) added. Unknown keys are skipped. */
export function giveSandboxKit(world: World, e: Entity): string[] {
  const got: string[] = [];
  for (const [key, n] of SANDBOX_KIT) { const id = itemIdSafe(world, key); if (id === undefined) continue; if (addItem(world, e, id, n) > 0) got.push(key); }
  return got;
}

/** Sandbox spawn: everyone around one point, 1.5 tiles apart, so two clients start in invite / trade range. */
export function sandboxSpawn(base: { x: number; y: number }, clientId: number): { x: number; y: number } {
  return { x: base.x + (clientId % 4) * 1.5, y: base.y + Math.floor(clientId / 4) % 4 * 1.5 };
}
