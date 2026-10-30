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
import { readSlots, rebaseCreated, slotsWeight, spoilMulOf, writeSlots, type SlotView } from "./inventory.js";

export const HOTBAR_SIZE = 8;
export const SplitStackCmd = defineCommand("gameplay.splitStack", { where: "u8", slot: "u8", count: "u16" });
export const MoveSlotCmd = defineCommand("gameplay.moveSlot", { where: "u8", slot: "u8", to: "u8" });
/** ADR-205: open container slot -> the actor's pack slot `to` (a hotbar slot in the UI); an occupied pack slot swaps back into the container. */
/** ADR-231: `dir` 1 = the reverse (pack slot `to` -> container slot `slot`, the container slot may be empty); same swap / merge rules. */
export const ContainerToSlotCmd = defineCommand("gameplay.containerToSlot", { slot: "u8", to: "u8", dir: "u8" });
/** Append-only (net ids follow this order). */
export type InventoryOpDef = typeof SplitStackCmd | typeof MoveSlotCmd | typeof ContainerToSlotCmd;
export const INVENTORY_OP_COMMANDS: readonly CommandDef[] = [SplitStackCmd, MoveSlotCmd, ContainerToSlotCmd];
export const INVENTORY_OP_RATES: Readonly<Record<string, number>> = { [SplitStackCmd.name]: 10, [MoveSlotCmd.name]: 10, [ContainerToSlotCmd.name]: 10 };

export type OpFail = "bad_holder" | "no_container" | "bad_slot" | "bad_count" | "empty_slot" | "no_space" | "same_slot" | "too_heavy" | "equipped" | undefined;
/** ADR-205: reasons the server's COMMAND_REJECT_REASONS appends (the others — no_space, bad_count, bad_slot, empty_slot — were already listed). */
export const INVENTORY_OP_REJECT_REASONS = ["bad_holder", "same_slot", "no_container", "too_heavy", "equipped"] as const;
/** Friendly text for every reason these commands can return. */
export const INVENTORY_OP_REJECT_TEXT: Readonly<Record<Exclude<OpFail, undefined>, string>> = {
  bad_holder: "That inventory isn't available.", no_container: "That container is closed — open it again.", bad_slot: "That slot doesn't exist.",
  bad_count: "Pick an amount between 1 and one less than the stack.", empty_slot: "That slot is empty.", no_space: "No empty slot to split into.",
  same_slot: "It's already in that slot.", too_heavy: "Too heavy — that swap would overload your pack or the container.", equipped: "Unequip that item first.",
};
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
  if (!ok(slot) || !ok(to)) return "bad_slot"; if (slot === to) return "same_slot"; if (!v.item(slot)) return "empty_slot"; return undefined;
}
/** ADR-231: older of two creation ticks (0 = none) — a merged stack never gets fresher. */
const olderCreated = (a: number, b: number): number => (a && b ? Math.min(a, b) : a || b);
/** ADR-231: units of `count` that merge onto a stack of `have` (same item + crafter, stackable); 0 = no merge (swap instead). */
export function mergeRoom(item: number, crafter: number, toItem: number, toCrafter: number, have: number, maxStack: number): number {
  return item && item === toItem && crafter === toCrafter && maxStack > 1 ? Math.max(0, maxStack - have) : 0;
}
/** Swap two slots, or (ADR-231, `maxStack` given) merge onto a matching stack: as much as fits moves, the rest stays. Returns "merge" | "swap" | false. */
export function moveSlots(v: SlotView, slot: number, to: number, maxStack?: (item: number) => number): "merge" | "swap" | false {
  if (checkMove(v, slot, to)) return false;
  const room = maxStack ? mergeRoom(v.item(slot), v.crafter(slot), v.item(to), v.crafter(to), v.count(to), maxStack(v.item(slot))) : 0;
  if (room > 0) { const n = Math.min(room, v.count(slot)); const left = v.count(slot) - n;
    v.put(to, v.item(to), v.count(to) + n, olderCreated(v.created(to), v.created(slot)), v.durability(to), v.crafter(to));
    if (left > 0) v.put(slot, v.item(slot), left, v.created(slot), v.durability(slot), v.crafter(slot)); else v.put(slot, 0, 0); return "merge"; }
  const a = [v.item(slot), v.count(slot), v.created(slot), v.durability(slot), v.crafter(slot)] as const;
  v.put(slot, v.item(to), v.count(to), v.created(to), v.durability(to), v.crafter(to)); v.put(to, ...a); return "swap";
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
const holderFail = (where: number): OpFail => (where === 1 ? "no_container" : "bad_holder");
/** ADR-231: after a full merge the stack at `a` is gone — references to it follow onto `b`. */
function redirectRefs(world: World, e: Entity, a: number, b: number): void {
  if (world.getField(e, Equipment, "mainHandSlot") === a) world.setField(e, Equipment, "mainHandSlot", b);
  if (world.getField(e, WeaponState, "slot") === a + 1) world.setField(e, WeaponState, "slot", b + 1);
  if (world.has(e, Worn)) { const arr = world.getArray(e, Worn, "slot")!; let ch = false; for (let i = 0; i < arr.length; i++) if (arr[i] === a + 1) { arr[i] = b + 1; ch = true; } if (ch) world.store(Worn).markChanged(entityIndex(e)); }
}
/** Is pack slot `s` referenced by the main hand, a loaded weapon or a worn piece? */
function slotInUse(world: World, e: Entity, s: number): boolean {
  if (world.getField(e, Equipment, "mainHandSlot") === s) return true;
  if (world.getField(e, WeaponState, "slot") === s + 1) return true;
  const arr = world.has(e, Worn) ? world.getArray(e, Worn, "slot") : undefined; return !!arr && Array.prototype.includes.call(arr, s + 1);
}
/** ADR-205 validation: Viewing container slot -> pack slot (swap). Weight: neither side may end above its cap unless it got lighter. */
export function checkContainerToSlot(world: World, actor: Entity, slot: number, to: number, dir = 0): OpFail {
  const c = holderOf(world, actor, 1); if (c === undefined) return "no_container";
  if (!world.has(actor, Inventory) || world.has(actor, Dead)) return "bad_holder";
  const a = readSlots(world, c), b = readSlots(world, actor);
  const ok = (v: SlotView, i: number): boolean => Number.isInteger(i) && i >= 0 && i < v.slotCount && i < CONTAINER_MAX_SLOTS;
  if (!ok(a, slot) || !ok(b, to)) return "bad_slot"; if (!(dir ? b.item(to) : a.item(slot))) return "empty_slot"; if (b.item(to) && slotInUse(world, actor, to)) return "equipped";
  const defs = gameplayDefs(world); const wOf = (item: number, n: number): number => (item ? (defs.items.get(item)?.weight ?? 0) * n : 0);
  let moveW = wOf(a.item(slot), a.count(slot)), backW = wOf(b.item(to), b.count(to));
  const m = ctsMerge(a, b, slot, to, dir, defs); if (m) { const w1 = wOf(a.item(slot), m.n); if (dir) { moveW = 0; backW = w1; } else { moveW = w1; backW = 0; } }
  const over = (v: SlotView, delta: number): boolean => { if (v.maxWeight <= 0 || delta <= 0) return false; return slotsWeight(v, defs) + delta > v.maxWeight + 1e-6; };
  if (over(b, moveW - backW) || over(a, backW - moveW)) return "too_heavy";
  return undefined;
}
/** ADR-231: container slot <-> pack slot merge (same item + crafter, stackable): `n` units move from the source side. */
function ctsMerge(a: SlotView, b: SlotView, slot: number, to: number, dir: number, defs: ReturnType<typeof gameplayDefs>): { n: number } | undefined {
  const [src, si, dst, di] = dir ? [b, to, a, slot] as const : [a, slot, b, to] as const;
  const room = mergeRoom(src.item(si), src.crafter(si), dst.item(di), dst.crafter(di), dst.count(di), defs.items.get(src.item(si))?.maxStack ?? 1);
  return room > 0 ? { n: Math.min(room, src.count(si)) } : undefined;
}
export function containerToSlot(world: World, actor: Entity, slot: number, to: number, dir = 0): OpFail {
  const f = checkContainerToSlot(world, actor, slot, to, dir); if (f) return f;
  const c = holderOf(world, actor, 1)!; const a = readSlots(world, c), b = readSlots(world, actor); const now = world.tick;
  const cm = spoilMulOf(world, c), pm = spoilMulOf(world, actor); const defs = gameplayDefs(world);
  const m = ctsMerge(a, b, slot, to, dir, defs);
  if (m) {
    const [src, si, dst, di, fm, tm] = dir ? [b, to, a, slot, pm, cm] as const : [a, slot, b, to, cm, pm] as const;
    const left = src.count(si) - m.n;
    dst.put(di, dst.item(di), dst.count(di) + m.n, olderCreated(dst.created(di), rebaseCreated(src.created(si), now, fm, tm)), dst.durability(di), dst.crafter(di));
    if (left > 0) src.put(si, src.item(si), left, src.created(si), src.durability(si), src.crafter(si)); else src.put(si, 0, 0);
    writeSlots(world, c, a, defs); writeSlots(world, actor, b, defs); return undefined;
  }
  const A = [a.item(slot), a.count(slot), rebaseCreated(a.created(slot), now, cm, pm), a.durability(slot), a.crafter(slot)] as const;
  const B = [b.item(to), b.count(to), rebaseCreated(b.created(to), now, pm, cm), b.durability(to), b.crafter(to)] as const;
  if (B[0]) a.put(slot, ...B); else a.put(slot, 0, 0); if (A[0]) b.put(to, ...A); else b.put(to, 0, 0);
  writeSlots(world, c, a, defs); writeSlots(world, actor, b, defs); return undefined;
}
export function splitStack(world: World, actor: Entity, where: number, slot: number, count: number): OpFail {
  const h = holderOf(world, actor, where); if (h === undefined) return holderFail(where);
  const v = readSlots(world, h); const r = checkSplit(v, slot, count); if ("fail" in r) return r.fail;
  splitSlots(v, slot, count); writeSlots(world, h, v, gameplayDefs(world)); return undefined;
}
export function moveSlot(world: World, actor: Entity, where: number, slot: number, to: number): OpFail {
  const h = holderOf(world, actor, where); if (h === undefined) return holderFail(where);
  const v = readSlots(world, h); const f = checkMove(v, slot, to); if (f) return f; const defs = gameplayDefs(world);
  const r = moveSlots(v, slot, to, (it) => defs.items.get(it)?.maxStack ?? 1); writeSlots(world, h, v, defs);
  if (h === actor) { if (r === "swap") remapRefs(world, h, slot, to); else if (r === "merge" && !v.item(slot)) redirectRefs(world, h, slot, to); } return undefined;
}
export function installInventoryOpCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(SplitStackCmd, { validate: (v, c) => { const h = holderOf(world, c.actor, v.where); if (h === undefined) return holderFail(v.where); const r = checkSplit(readSlots(world, h), v.slot, v.count); return "fail" in r ? r.fail : undefined; },
    handle: (v, c) => { splitStack(world, c.actor, v.where, v.slot, v.count); } });
  handlers.on(MoveSlotCmd, { validate: (v, c) => { const h = holderOf(world, c.actor, v.where); return h === undefined ? holderFail(v.where) : checkMove(readSlots(world, h), v.slot, v.to); },
    handle: (v, c) => { moveSlot(world, c.actor, v.where, v.slot, v.to); } });
  handlers.on(ContainerToSlotCmd, { validate: (v, c) => checkContainerToSlot(world, c.actor, v.slot, v.to, v.dir), handle: (v, c) => { containerToSlot(world, c.actor, v.slot, v.to, v.dir); } });
}
