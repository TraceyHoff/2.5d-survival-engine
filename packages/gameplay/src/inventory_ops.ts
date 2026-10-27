/**
 * ADR-204: split a stack and move a slot (to the hotbar = inventory slots 0..HOTBAR_SLOTS-1), server-authoritative.
 *  - SplitStackCmd { where, slot, count }: moves `count` (1..stack-1) of the slot into the first empty slot of the same holder.
 *  - MoveSlotCmd { where, slot, to }: swaps two slots (empty destination = plain move); slot references follow the item
 *    (Equipment.mainHandSlot, Worn.slot[], WeaponState.slot) so equipped / worn gear stays equipped.
 * `where` 0 = the actor's own Inventory, 1 = the container the actor is Viewing (never stall stock / tills). Slot bounds are
 * checked against the holder's live slotCount (<= CONTAINER_MAX_SLOTS = 96). Totals, weight, freshness, durability and
 * crafter provenance are unchanged (pure re-arrangement), so persistence needs no schema change.
 */
import { defineCommand, entityIndex, type CommandDef, type CommandHandlers, type Entity, type World } from "@engine/core";
import { AttachKind, CONTAINER_MAX_SLOTS, Container, Dead, Equipment, Inventory, NO_SLOT, PieceLink, StallHeader, Viewing, WeaponState, Worn } from "./components.js";
import { gameplayDefs } from "./config.js";
import { readSlots, writeSlots, type SlotView } from "./inventory.js";

export const HOTBAR_SIZE = 8;
export const SplitStackCmd = defineCommand("gameplay.splitStack", { where: "u8", slot: "u8", count: "u16" });
export const MoveSlotCmd = defineCommand("gameplay.moveSlot", { where: "u8", slot: "u8", to: "u8" });
export const INVENTORY_OP_COMMANDS: readonly CommandDef[] = [SplitStackCmd, MoveSlotCmd];
export const INVENTORY_OP_RATES: Readonly<Record<string, number>> = { [SplitStackCmd.name]: 10, [MoveSlotCmd.name]: 10 };

export type OpFail = "bad_holder" | "bad_slot" | "bad_count" | "no_space" | "same_slot" | undefined;
/** Pure: validation for a split (no mutation). Returns the destination slot or a failure reason. */
export function checkSplit(v: SlotView, slot: number, count: number): { to: number } | { fail: Exclude<OpFail, undefined> } {
  if (!Number.isInteger(slot) || slot < 0 || slot >= v.slotCount || slot >= CONTAINER_MAX_SLOTS) return { fail: "bad_slot" };
  const have = v.count(slot); if (!v.item(slot) || have < 2) return { fail: "bad_count" };
  if (!Number.isInteger(count) || count < 1 || count >= have) return { fail: "bad_count" };
  for (let i = 0; i < v.slotCount; i++) if (!v.item(i)) return { to: i };
  return { fail: "no_space" };
}
export function splitSlots(v: SlotView, slot: number, count: number): number {
  const r = checkSplit(v, slot, count); if ("fail" in r) return -1;
  v.put(r.to, v.item(slot), count, v.created(slot), v.durability(slot), v.crafter(slot)); v.put(slot, v.item(slot), v.count(slot) - count); return r.to;
}
export function checkMove(v: SlotView, slot: number, to: number): OpFail {
  const ok = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < v.slotCount && i < CONTAINER_MAX_SLOTS;
  if (!ok(slot) || !ok(to)) return "bad_slot"; if (slot === to) return "same_slot"; if (!v.item(slot)) return "bad_count"; return undefined;
}
export function moveSlots(v: SlotView, slot: number, to: number): boolean {
  if (checkMove(v, slot, to)) return false;
  const a = [v.item(slot), v.count(slot), v.created(slot), v.durability(slot), v.crafter(slot)] as const;
  v.put(slot, v.item(to), v.count(to), v.created(to), v.durability(to), v.crafter(to)); v.put(to, ...a); return true;
}
/** Default split amount (half, rounded down, at least 1). */
export const defaultSplit = (count: number): number => Math.max(1, Math.floor(count / 2));

function holderOf(world: World, actor: Entity, where: number): Entity | undefined {
  if (!world.isAlive(actor) || world.has(actor, Dead)) return undefined;
  if (where === 0) return world.has(actor, Inventory) ? actor : undefined;
  if (where !== 1) return undefined;
  const c = world.getField(actor, Viewing, "container"); if (c === undefined || !world.isAlive(c as Entity) || !world.has(c as Entity, Container)) return undefined;
  if (world.has(c as Entity, StallHeader) || world.getField(c as Entity, PieceLink, "kind") === AttachKind.Till) return undefined;
  return c as Entity;
}
/** Keep main hand / worn / magazine pointers on the item that moved (swap a <-> b). */
function remapRefs(world: World, e: Entity, a: number, b: number): void {
  const sw = (s: number): number => (s === a ? b : s === b ? a : s);
  const mh = world.getField(e, Equipment, "mainHandSlot"); if (mh !== undefined && mh !== NO_SLOT && sw(mh) !== mh) world.setField(e, Equipment, "mainHandSlot", sw(mh));
  const ws = world.getField(e, WeaponState, "slot"); if (ws) { const n = sw(ws - 1) + 1; if (n !== ws) world.setField(e, WeaponState, "slot", n); }
  if (world.has(e, Worn)) { const arr = world.getArray(e, Worn, "slot")!; let ch = false; for (let i = 0; i < arr.length; i++) if (arr[i]) { const n = sw(arr[i]! - 1) + 1; if (n !== arr[i]) { arr[i] = n; ch = true; } } if (ch) world.store(Worn).markChanged(entityIndex(e)); }
}
export function splitStack(world: World, actor: Entity, where: number, slot: number, count: number): OpFail {
  const h = holderOf(world, actor, where); if (h === undefined) return "bad_holder";
  const v = readSlots(world, h); const r = checkSplit(v, slot, count); if ("fail" in r) return r.fail;
  splitSlots(v, slot, count); writeSlots(world, h, v, gameplayDefs(world)); return undefined;
}
export function moveSlot(world: World, actor: Entity, where: number, slot: number, to: number): OpFail {
  const h = holderOf(world, actor, where); if (h === undefined) return "bad_holder";
  const v = readSlots(world, h); const f = checkMove(v, slot, to); if (f) return f;
  moveSlots(v, slot, to); writeSlots(world, h, v, gameplayDefs(world)); if (h === actor) remapRefs(world, h, slot, to); return undefined;
}
export function installInventoryOpCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(SplitStackCmd, { validate: (v, c) => { const h = holderOf(world, c.actor, v.where); if (h === undefined) return "bad_holder"; const r = checkSplit(readSlots(world, h), v.slot, v.count); return "fail" in r ? r.fail : undefined; },
    handle: (v, c) => { splitStack(world, c.actor, v.where, v.slot, v.count); } });
  handlers.on(MoveSlotCmd, { validate: (v, c) => { const h = holderOf(world, c.actor, v.where); return h === undefined ? "bad_holder" : checkMove(readSlots(world, h), v.slot, v.to); },
    handle: (v, c) => { moveSlot(world, c.actor, v.where, v.slot, v.to); } });
}
