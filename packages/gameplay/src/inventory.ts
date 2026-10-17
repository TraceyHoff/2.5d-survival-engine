/**
 * Inventory operations over the fixed-slot Inventory component.
 *
 * All mutations go through a SlotView so the same logic runs against the live SoA store or a scratch
 * copy (used for transactional "would this fit?" checks in crafting). Rules:
 *  - item id 0 = empty slot; counts never exceed the item's maxStack.
 *  - add fills existing stacks first (lowest slot first), then empty slots; partial adds are allowed
 *    and return the amount actually added (limited by slots AND maxWeight).
 *  - remove is all-or-nothing and takes from the highest slot first.
 *  - weight is recomputed and cached in Inventory.weight on every write.
 */
import { entityIndex, type Entity, type World } from "@engine/core";
import { COUNT_FIELDS, INVENTORY_SLOTS, ITEM_FIELDS, Inventory } from "./components.js";
import { gameplayDefs } from "./config.js";
import type { GameDefs, ItemCount } from "./defs.js";

export interface SlotView {
  readonly slotCount: number;
  readonly maxWeight: number;
  item(i: number): number;
  count(i: number): number;
  put(i: number, item: number, count: number): void;
}

class ScratchSlots implements SlotView {
  readonly items: number[]; readonly counts: number[];
  constructor(readonly slotCount: number, readonly maxWeight: number, items: number[], counts: number[]) { this.items = items; this.counts = counts; }
  item(i: number): number { return this.items[i] ?? 0; }
  count(i: number): number { return this.counts[i] ?? 0; }
  put(i: number, item: number, count: number): void { this.items[i] = count > 0 ? item : 0; this.counts[i] = count > 0 ? count : 0; }
}

/** Copies an entity's slots out of the store. */
function readSlots(world: World, e: Entity): ScratchSlots {
  const st = world.store(Inventory); const s = st.slot(entityIndex(e));
  if (s < 0) throw new Error("entity has no Inventory");
  const n = Math.min(st.data.slotCount[s]!, INVENTORY_SLOTS);
  const items: number[] = []; const counts: number[] = [];
  for (let i = 0; i < n; i++) { items.push(st.data[ITEM_FIELDS[i]!]![s]!); counts.push(st.data[COUNT_FIELDS[i]!]![s]!); }
  return new ScratchSlots(n, st.data.maxWeight[s]!, items, counts);
}

/** Writes slots + cached weight back with raw typed-array writes, then markChanged (ADR-015). */
function writeSlots(world: World, e: Entity, v: ScratchSlots, defs: GameDefs): void {
  const st = world.store(Inventory); const idx = entityIndex(e); const s = st.slot(idx);
  for (let i = 0; i < v.slotCount; i++) { st.data[ITEM_FIELDS[i]!]![s] = v.item(i); st.data[COUNT_FIELDS[i]!]![s] = v.count(i); }
  st.data.weight[s] = slotsWeight(v, defs);
  st.markChanged(idx);
}

export function slotsWeight(v: SlotView, defs: GameDefs): number {
  let w = 0;
  for (let i = 0; i < v.slotCount; i++) { const id = v.item(i); if (id !== 0) w += (defs.items.get(id)?.weight ?? 0) * v.count(i); }
  return w;
}
export function slotsCount(v: SlotView, item: number): number {
  let n = 0; for (let i = 0; i < v.slotCount; i++) if (v.item(i) === item) n += v.count(i); return n;
}
/** Max units of `item` that fit (slots and weight), capped at `count`. */
export function slotsCanAdd(v: SlotView, item: number, count: number, defs: GameDefs): number {
  const def = defs.items.get(item); if (!def || count <= 0) return 0;
  let space = 0;
  for (let i = 0; i < v.slotCount && space < count; i++) {
    const id = v.item(i);
    if (id === item) space += Math.max(0, def.maxStack - v.count(i));
    else if (id === 0) space += def.maxStack;
  }
  let fit = Math.min(space, count);
  if (v.maxWeight > 0 && def.weight > 0) {
    const free = v.maxWeight - slotsWeight(v, defs);
    fit = Math.min(fit, Math.max(0, Math.floor(free / def.weight + 1e-9)));
  }
  return fit;
}
export function slotsAdd(v: SlotView, item: number, count: number, defs: GameDefs): number {
  const def = defs.items.get(item); if (!def) return 0;
  const total = slotsCanAdd(v, item, count, defs);
  let left = total;
  for (let i = 0; i < v.slotCount && left > 0; i++) {
    if (v.item(i) !== item) continue;
    const n = Math.min(left, def.maxStack - v.count(i)); if (n > 0) { v.put(i, item, v.count(i) + n); left -= n; }
  }
  for (let i = 0; i < v.slotCount && left > 0; i++) {
    if (v.item(i) !== 0) continue;
    const n = Math.min(left, def.maxStack); v.put(i, item, n); left -= n;
  }
  return total - left;
}
export function slotsRemove(v: SlotView, item: number, count: number): boolean {
  if (count <= 0) return true;
  if (slotsCount(v, item) < count) return false;
  let left = count;
  for (let i = v.slotCount - 1; i >= 0 && left > 0; i--) {
    if (v.item(i) !== item) continue;
    const n = Math.min(left, v.count(i)); v.put(i, item, v.count(i) - n); left -= n;
  }
  return true;
}

// ---- world-level API ---------------------------------------------------------------------------

export function countItem(world: World, e: Entity, item: number): number { return slotsCount(readSlots(world, e), item); }
export function canAddItem(world: World, e: Entity, item: number, count: number): number {
  return slotsCanAdd(readSlots(world, e), item, count, gameplayDefs(world));
}
/** Adds up to `count`; returns how many were added. */
export function addItem(world: World, e: Entity, item: number, count: number): number {
  const defs = gameplayDefs(world); const v = readSlots(world, e);
  const n = slotsAdd(v, item, count, defs); if (n > 0) writeSlots(world, e, v, defs); return n;
}
/** All-or-nothing. */
export function removeItem(world: World, e: Entity, item: number, count: number): boolean {
  const defs = gameplayDefs(world); const v = readSlots(world, e);
  if (!slotsRemove(v, item, count)) return false;
  writeSlots(world, e, v, defs); return true;
}
/** Moves up to `count` of `item` from one inventory to another (limited by what `from` has and what `to` fits). */
export function transferItem(world: World, from: Entity, to: Entity, item: number, count: number): number {
  if (from === to) return 0;
  const defs = gameplayDefs(world);
  const a = readSlots(world, from); const b = readSlots(world, to);
  const n = Math.min(slotsCount(a, item), slotsCanAdd(b, item, count, defs));
  if (n <= 0) return 0;
  slotsRemove(a, item, n); slotsAdd(b, item, n, defs);
  writeSlots(world, from, a, defs); writeSlots(world, to, b, defs);
  return n;
}
/**
 * Atomically removes `take` and adds `give`. Returns false (and changes nothing) if any ingredient is
 * missing or any output does not fully fit after the removal.
 */
export function exchangeItems(world: World, e: Entity, take: readonly ItemCount[], give: readonly ItemCount[], dryRun = false): boolean {
  const defs = gameplayDefs(world); const v = readSlots(world, e);
  for (const t of take) if (!slotsRemove(v, t.item, t.count)) return false;
  for (const g of give) if (slotsAdd(v, g.item, g.count, defs) !== g.count) return false;
  if (!dryRun) writeSlots(world, e, v, defs);
  return true;
}
export function slotItem(world: World, e: Entity, slot: number): { item: number; count: number } {
  const v = readSlots(world, e);
  return slot < v.slotCount ? { item: v.item(slot), count: v.count(slot) } : { item: 0, count: 0 };
}
/** Removes one unit from a specific slot. */
export function takeFromSlot(world: World, e: Entity, slot: number): number {
  const defs = gameplayDefs(world); const v = readSlots(world, e);
  if (slot >= v.slotCount || v.count(slot) === 0) return 0;
  const item = v.item(slot); v.put(slot, item, v.count(slot) - 1); writeSlots(world, e, v, defs); return item;
}
/** Debug/UI view: non-empty slots. */
export function listSlots(world: World, e: Entity): { slot: number; item: number; count: number }[] {
  const v = readSlots(world, e); const out: { slot: number; item: number; count: number }[] = [];
  for (let i = 0; i < v.slotCount; i++) if (v.item(i) !== 0) out.push({ slot: i, item: v.item(i), count: v.count(i) });
  return out;
}
