import { defineResource, type Entity, type World } from "@engine/core";
import { Latency } from "./components.js";
import type { GameDefs } from "./defs.js";

/**
 * server     = authoritative: runs everything, including RNG-driven outcomes.
 * client     = predicted: runs deterministic, RNG-free parts only (stamina, cooldowns, crafting
 *              progress, vitals); RNG/world-state outcomes arrive by replication.
 * standalone = single player / tests: same as server.
 */
export type GameplayRole = "server" | "client" | "standalone";
export interface GameplayConfigRes { readonly defs: GameDefs; readonly role: GameplayRole }
export const GameplayConfig = defineResource<GameplayConfigRes>("GameplayConfig");

export const gameplayDefs = (w: World): GameDefs => w.resource(GameplayConfig).defs;
export const isAuthority = (w: World): boolean => w.resource(GameplayConfig).role !== "client";

/**
 * Server range slack (Netcode): maxSpeed x min(rtt/2, 200 ms). Latency.rttMs is written by net on the server;
 * clients (and entities without Latency) get 0, so prediction is never more lenient than the server.
 */
export function rangeSlack(w: World, e: Entity): number {
  const rtt = w.getField(e, Latency, "rttMs"); if (rtt === undefined || !isAuthority(w)) return 0;
  return gameplayDefs(w).building.playerMaxSpeed * Math.min(rtt / 2, 200) / 1000;
}
