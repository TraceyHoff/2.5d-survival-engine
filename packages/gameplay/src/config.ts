import { defineResource, type World } from "@engine/core";
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
