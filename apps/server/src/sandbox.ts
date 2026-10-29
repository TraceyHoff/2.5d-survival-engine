/**
 * ADR-140 dev sandbox (test/QA only; never on in normal play): every joining player gets a building / crafting /
 * gear / food kit and spawns next to the other players (a fixed spot = the "dev teleport" that puts clients side by
 * side for party / trade / clan tests). Enabled by `?dev=sandbox` (singleplayer, own save slot) or DEV_SANDBOX=1 (server).
 */
import type { World, Entity } from "@engine/core";
import { Transform } from "@engine/core";
import { addItem, Container, ContainerViewers, indexEntity, itemIdSafe, LootBag, PET_TREATS, spawnAnimal } from "@engine/gameplay";

/** Kit sized to fit the 16-slot / weight-capped starting inventory with 2 slots left free (ADR-144: a full bag paused
 * every craft at 0%, so the tutorial's craft step queued a Stone Axe that never arrived): gear, food, campfire + workbench + anvil, twig build, gravel road, sign, market stall (cloth + fiber, ADR-142). */
export const SANDBOX_KIT: readonly (readonly [string, number])[] = [
  ["iron_helmet", 1], ["leather_jacket", 1], ["iron_sword", 1], ["stone_shovel", 1],
  ["cooked_meat", 5],
  ["wood", 16], ["stone", 10], ["sticks", 24], ["gravel", 10], ["sign_wooden_post", 2], ["iron_ingot", 6], ["planks", 4], ["cloth", 2], ["fiber", 4],
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

/** ADR-145 sandbox "pet corner" (once per world, 5 tiles east of the shared spawn): a public crate of every treat plus
 * pet food, and a dachshund, a tabby and a parrot to tame — so pet QA needs no crafting and the starting bag keeps its
 * 2 free slots (ADR-144). */
export const SANDBOX_PETS = ["animal_dog_dachshund", "animal_cat_tabby", "animal_parrot"] as const;
export function sandboxPetCorner(world: World, base: { x: number; y: number }): Entity | undefined {
  for (const b of world.query([LootBag])) if (world.getField(b, LootBag, "despawnAtTick") === 0xffffffff) return undefined; // already placed (restored save)
  const x = base.x + 5, y = base.y; const crate = world.create();
  world.add(crate, Transform, { x, y }).add(crate, Container, { slotCount: 12 }).add(crate, ContainerViewers).add(crate, LootBag, { owner: 0, despawnAtTick: 0xffffffff });
  for (const k of [...PET_TREATS, "cooked_fish", "wheat"]) { const id = itemIdSafe(world, k); if (id !== undefined) addItem(world, crate, id, 10); }
  indexEntity(world, crate);
  SANDBOX_PETS.forEach((k, i) => spawnAnimal(world, k, x + 1.5 + i * 1.2, y + 1.5));
  return crate;
}

/** ADR-145 QA pet kit (sandbox only, DevPetKit / `__qa.petKit()`): 5 dog biscuits + 5 meaty chews (the kit leaves exactly 2 free slots, ADR-144) and a dachshund 1 tile
 * east of the player, so online pet tests need no crate. Returns the dog. */
export const SANDBOX_PET_KIT = ["dog_biscuit", "meaty_chew"] as const;
export function sandboxPetKit(world: World, e: Entity): Entity | undefined {
  const t = world.get(e, Transform); if (!t) return undefined;
  for (const k of SANDBOX_PET_KIT) { const id = itemIdSafe(world, k); if (id !== undefined) addItem(world, e, id, 5); }
  return spawnAnimal(world, "animal_dog_dachshund", t.x + 1, t.y);
}
