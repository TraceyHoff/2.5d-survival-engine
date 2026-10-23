/**
 * NetId <-> local entity lookup by World, for code that only holds a world (bots, gameplay sensors, tools).
 *
 * Entity ids are per-world and differ between server and client; NetIds are the shared names. Anything a client or a
 * bot targets (command entity fields, chat mentions, UI picks) must be named by NetId — `client.sendCommand` converts
 * entity fields for you, and these helpers cover the rest:
 *
 *   netIdOf(clientWorld, eid)     -> NetId of a replicated entity in that world (undefined if not replicated / unknown)
 *   eidOfNetId(world, netId)      -> local entity for a NetId (undefined if this world does not hold it)
 *
 * Works on both sides: a NetClient registers its world (local mirror ids), a NetServer registers its world
 * (authoritative ids). Server command handlers already receive resolved, validated entities (see NetServerOptions.entityRefs).
 */
import type { Entity, World } from "@engine/core";

export interface NetIdResolver { netIdOf(e: Entity): number | undefined; entityOf(netId: number): Entity | undefined }
const byWorld = new WeakMap<World, NetIdResolver>();

/** Internal: NetClient / NetServer register themselves for their world. Last registration wins. */
export function registerNetIds(world: World, r: NetIdResolver): void { byWorld.set(world, r); }

export function netIdOf(world: World, eid: Entity): number | undefined { return byWorld.get(world)?.netIdOf(eid); }
export function eidOfNetId(world: World, netId: number): Entity | undefined {
  const e = byWorld.get(world)?.entityOf(netId); return e !== undefined && world.isAlive(e) ? e : undefined;
}
