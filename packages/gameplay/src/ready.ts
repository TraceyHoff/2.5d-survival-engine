/**
 * Task 14: the client tells the server it has finished loading (second loading screen dismissed).
 * A direct command like the pet commands (registered + bridged, handled by installReadyCommands) — NOT an
 * input-queue command, so it never becomes a PlayerIntent.
 */
import { defineCommand, type CommandDef, type CommandHandlers, type Entity, type World } from "@engine/core";
import { PlayerReady } from "./components.js";

export const ReadyCmd = defineCommand("gameplay.ready", {});
export const READY_COMMANDS: readonly CommandDef[] = [ReadyCmd];
export const READY_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = {};

/** True when `e` is a joined player whose client has not finished loading yet. */
export const pendingReady = (world: World, e: Entity): boolean => world.has(e, PlayerReady) && world.getField(e, PlayerReady, "ready") !== 1;
/** Mark a joined player loaded in (idempotent; adds the component if a path missed it). */
export function markReady(world: World, e: Entity): void {
  if (world.has(e, PlayerReady)) world.set(e, PlayerReady, { ready: 1 }); else world.add(e, PlayerReady, { ready: 1 });
}

export function installReadyCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(ReadyCmd, { handle: (_v, c) => { markReady(world, c.actor); } });
}
