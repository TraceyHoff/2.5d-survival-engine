/**
 * ADR-109 vehicle keys. A deployed (crafted) vehicle gets VehicleLock{keyId} and its crafter a `vehicle_key` item whose
 * slot crafterId carries that keyId (the item's instance data, so it already syncs, persists, stacks apart, and survives
 * trade / store / death-bag moves through the normal slot path). Driving (driver seat, engine on) needs a matching key
 * in the driver's Inventory; passengers don't. keyId 0 = open (ownerless world vehicles). A destroyed vehicle leaves its
 * keys pointing at nothing: they still exist as items but open nothing (tooltip says so).
 * Legacy vehicles (no VehicleLock) are migrated by keyIssueSystem: crafted ones get a lock + a key handed to the owner
 * once that player is present; world-spawned (no crafter) ones get keyId 0 and stay open.
 */
import { PlayerId, type Entity, type World } from "@engine/core";
import { Inventory, Vehicle, VehicleCondition, VehicleLock } from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { addItem, listSlots } from "./inventory.js";

export const KEY_ITEM = "vehicle_key";
export const keyItemId = (world: World): number => gameplayDefs(world).itemId(KEY_ITEM) ?? 0;
export const lockKeyId = (world: World, v: Entity): number => world.getField(v, VehicleLock, "keyId") ?? 0;
/** Short code shown in the tooltip, e.g. "K-3F9A". Same code on the key and the vehicle. */
export const keyCode = (keyId: number): string => `K-${((Math.imul(keyId, 0x9e3779b1) >>> 0) % 0xfffff).toString(36).toUpperCase().padStart(4, "0")}`;

function nextKeyId(world: World): number {
  let m = 0; for (const v of world.query([VehicleLock])) m = Math.max(m, world.getField(v, VehicleLock, "keyId")!);
  return m + 1;
}
/** keyIds of every vehicle_key in `e`'s Inventory. */
export function keysHeld(world: World, e: Entity): number[] {
  if (!world.has(e, Inventory)) return [];
  const k = keyItemId(world); return listSlots(world, e).filter((s) => s.item === k && s.count > 0 && s.crafterId).map((s) => s.crafterId);
}
/** May `actor` drive `v`? Open vehicles (keyId 0 / no lock) yes; locked ones need the matching key in the Inventory. */
export function hasKeyFor(world: World, actor: Entity, v: Entity): boolean {
  const id = lockKeyId(world, v); return id === 0 || keysHeld(world, actor).includes(id);
}
/** The live vehicle a key opens, or undefined (destroyed / never existed). */
export function vehicleForKey(world: World, keyId: number): Entity | undefined {
  if (!keyId) return undefined;
  for (const v of world.query([VehicleLock, Vehicle])) if (world.getField(v, VehicleLock, "keyId") === keyId) return v;
  return undefined;
}
/** Lock `v` and give `holder` its key (owner = PlayerId recorded for migration / UI). Returns the keyId. */
export function lockAndIssueKey(world: World, v: Entity, holder: Entity | undefined, owner: number): number {
  const keyId = nextKeyId(world);
  const issued = holder !== undefined && addItem(world, holder, keyItemId(world), 1, keyId) === 1 ? 1 : 0;
  world.add(v, VehicleLock, { keyId, owner, issued });
  return keyId;
}
function playerById(world: World, id: number): Entity | undefined {
  if (!id || !world.isRegistered(PlayerId)) return undefined;
  for (const e of world.query([PlayerId, Inventory])) if (world.getField(e, PlayerId, "id") === id) return e;
  return undefined;
}
/** Authority: migrate unlocked vehicles and hand out keys owed to owners who have since joined. */
export function keyIssueSystem(world: World): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const k = keyItemId(world); if (!k) return;
  for (const v of [...world.query([Vehicle])]) {
    if (!world.has(v, VehicleLock)) {
      const owner = world.getField(v, VehicleCondition, "crafterId") ?? 0;
      if (!owner) { world.add(v, VehicleLock, { keyId: 0, owner: 0, issued: 1 }); continue; }
      world.add(v, VehicleLock, { keyId: nextKeyId(world), owner, issued: 0 });
    }
    if (world.getField(v, VehicleLock, "issued")) continue;
    const p = playerById(world, world.getField(v, VehicleLock, "owner")!); if (p === undefined) continue;
    if (addItem(world, p, k, 1, lockKeyId(world, v)) === 1) world.setField(v, VehicleLock, "issued", 1);
  }
}
/** Tooltip line for a key slot. */
export function keyTooltip(world: World, keyId: number): string {
  if (!keyId) return "Blank key";
  return vehicleForKey(world, keyId) === undefined ? `Key ${keyCode(keyId)} · vehicle destroyed` : `Key ${keyCode(keyId)}`;
}
