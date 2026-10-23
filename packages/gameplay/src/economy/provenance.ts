/**
 * Crafter provenance + core container integration.
 * Inventory and Container are registered with core (arrayFieldsContainer) so transfers/trades/stall sales run in
 * core transaction(); the per-slot crafterId (u32 PlayerId, 0 = gathered) rides in core Slot.meta (shim until core
 * carries Slot.crafterId in HEAD: swap `meta: "crafterId"` for `crafterId: "crafterId"`). Items with different
 * crafters never stack: core's tx.transfer is guarded by a validator, and gameplay adds via txAdd (stack key =
 * item + crafterId + durability).
 */
/**
 * Crafter provenance + core container integration (core fb7bf56, ADR-074).
 * Inventory and Container are registered with core Containers (arrayFieldsContainer, crafterId: "crafterId"), so
 * transfers, trades (net purchaseSwap / coreTradeInventory) and stall sales run in core transaction() and core's
 * stack key (item, crafterId, durability) keeps different crafters apart. Gameplay's own SlotView ops use the same key.
 */
import { fillLevel, spoilStageIndex, spoilStages } from "../food.js";
import type { SpoilStage } from "../defs.js";
import { arrayFieldsContainer, installContainers, playerOf, PlayerId, PlayerNames, PlayerNameRegistry, type Entity, type World } from "@engine/core";
import { Container, Inventory } from "../components.js";
import { gameplayDefs } from "../config.js";
import { freshness, slotsDef, spoilMulOf } from "../inventory.js";
import { ECONOMY } from "./config.js";

const FIELDS = { item: "items", count: "counts", crafterId: "crafterId", durability: "durability", createdTick: "createdTick", capacity: "slotCount" } as const;
const REGISTERED = new WeakSet<object>();
/** Called by installGameplay: registers Inventory + Container with core Containers (maxStack from item data). */
export function installGameplayContainers(world: World): void {
  const defs = gameplayDefs(world);
  const reg = installContainers(world, (item) => defs.items.get(item)?.maxStack ?? 1);
  if (REGISTERED.has(reg)) return; REGISTERED.add(reg);
  reg.register(Inventory, arrayFieldsContainer(Inventory, FIELDS));
  reg.register(Container, arrayFieldsContainer(Container, FIELDS));
}
/** The world's core PlayerNameRegistry (created on first use; net NameSync replicates it, clients use client.names). */
export function playerNames(world: World): PlayerNameRegistry {
  let n = world.getResource(PlayerNames); if (!n) world.setResource(PlayerNames, (n = new PlayerNameRegistry())); return n;
}

/** crafterId recorded for an item crafted by `e` (its persistent PlayerId; 0 for anonymous items such as coin). */
export function crafterIdFor(world: World, e: Entity, item: number): number {
  const key = gameplayDefs(world).items.get(item)?.key; if (key && ECONOMY.anonymousItems.includes(key)) return 0;
  return world.isRegistered(PlayerId) ? playerOf(world, e) : 0;
}

export interface NameLookup { get(playerId: number): string | undefined }
export interface ItemInfo { itemKey: string; count: number; durability: number; freshnessStage: number; crafterId: number; crafterName: string;
  /** Liquid containers (water_flask): fill 0..1; undefined otherwise. */
  fill?: number }
/** Spoilage stage 0..3 from the spoiled fraction (thresholds 25/50/80%); items that never spoil are stage 0. */
/** Stage 0..3 (fresh, stale, spoiling, rotten); data stages from environment.spoilage.stages. */
export function freshnessStage(fresh: number, stages?: readonly SpoilStage[]): number { return spoilStageIndex(fresh, stages); }
/**
 * Tooltip / inspection data for a slot. crafterName is resolved from the PlayerId at read time (follows renames):
 * server = the world's name directory; client = pass `client.names`.
 */
export function itemInfo(world: World, e: Entity, slot: number, names: NameLookup = playerNames(world)): ItemInfo | undefined {
  const def = slotsDef(world, e); const n = world.getField(e, def, "slotCount") ?? 0; if (slot < 0 || slot >= n) return undefined;
  const item = world.getArray(e, def, "items")![slot]!; if (!item) return undefined;
  const defs = gameplayDefs(world);
  const crafterId = world.getArray(e, def, "crafterId")![slot]!;
  const fresh = freshness(defs, item, world.getArray(e, def, "createdTick")![slot]!, spoilMulOf(world, e), world.tick, 1 / 20);
  const info: ItemInfo = {
    itemKey: defs.items.get(item)?.key ?? "", count: world.getArray(e, def, "counts")![slot]!, durability: world.getArray(e, def, "durability")![slot]!,
    freshnessStage: freshnessStage(fresh, spoilStages(defs)), crafterId, crafterName: crafterId ? names.get(crafterId) ?? `#${crafterId}` : "",
  };
  const fill = fillLevel(defs, item, world.getArray(e, def, "durability")![slot]!);
  if (fill !== undefined) info.fill = fill;
  return info;
}
