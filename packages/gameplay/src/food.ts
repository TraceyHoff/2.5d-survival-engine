/**
 * Food helpers: four data-driven spoilage stages (environment.spoilage.stages) and liquid containers
 * (items with `sips`, e.g. water_flask; the fill lives in the slot's durability 0..sips, so it replicates and
 * persists with the slot tuple at no extra cost).
 */
import type { Entity, World } from "@engine/core";
import { gameplayDefs } from "./config.js";
import type { GameDefs, SpoilStage } from "./defs.js";
import { readSlots, writeSlots } from "./inventory.js";

export const DEFAULT_SPOIL_STAGES: readonly SpoilStage[] = [
  { key: "fresh", minFresh: 0.75, nutritionMul: 1, sick: false }, { key: "stale", minFresh: 0.5, nutritionMul: 0.75, sick: false },
  { key: "spoiling", minFresh: 0.2, nutritionMul: 0.5, sick: true }, { key: "rotten", minFresh: 0, nutritionMul: 0.25, sick: true },
];
export const spoilStages = (defs: GameDefs): readonly SpoilStage[] => defs.environment.spoilage.stages ?? DEFAULT_SPOIL_STAGES;
/** Stage index 0..3 (fresh, stale, spoiling, rotten) for a freshness 0..1. */
export function spoilStageIndex(fresh: number, stages: readonly SpoilStage[] = DEFAULT_SPOIL_STAGES): number {
  for (let i = 0; i < stages.length; i++) if (fresh >= stages[i]!.minFresh) return i;
  return stages.length - 1;
}

/** Fill 0..1 of a liquid container slot; undefined for other items. */
export function fillLevel(defs: GameDefs, item: number, durability: number): number | undefined {
  const sips = defs.items.get(item)?.sips ?? 0; return sips > 0 ? Math.max(0, Math.min(1, durability / sips)) : undefined;
}
/** Refills a liquid container slot by `sips` (default: to full). Authority; returns sips added. Hook for water sources. */
export function fillContainer(world: World, e: Entity, slot: number, sips = Infinity): number {
  const defs = gameplayDefs(world); const v = readSlots(world, e); if (slot < 0 || slot >= v.slotCount) return 0;
  const item = v.item(slot); const max = defs.items.get(item)?.sips ?? 0; if (!max) return 0;
  const cur = v.durability(slot); const next = Math.min(max, cur + sips); if (next === cur) return 0;
  v.put(slot, item, v.count(slot), v.created(slot), next); writeSlots(world, e, v, defs); return next - cur;
}
/** Drinks one sip (durability - 1); the container stays (empty at 0). Returns false when empty. */
export function takeSip(world: World, e: Entity, slot: number): boolean {
  const defs = gameplayDefs(world); const v = readSlots(world, e); const cur = v.durability(slot); if (cur <= 0) return false;
  v.put(slot, v.item(slot), v.count(slot), v.created(slot), cur - 1); writeSlots(world, e, v, defs); return true;
}

