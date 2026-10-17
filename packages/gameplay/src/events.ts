/**
 * Gameplay events, emitted through core's EventBus (world.events.emit) and delivered at the end of
 * the tick in emission order. Payloads are numeric; entity fields are LOCAL entity ids. Events are
 * not replicated: the server uses them for logs/achievements/net-side effects, the client gets its
 * own from the predicted sim or derives them from snapshot changes (see DESIGN.md).
 */
import { defineEvent, type Entity } from "@engine/core";
import type { WeatherKind } from "./defs.js";
import type { DamageCause } from "./components.js";

export const enum GatherFail { Cooldown = 1, InvalidTarget = 2, Depleted = 3, OutOfRange = 4, WrongTool = 5, Exhausted = 6 }
export const enum CraftFail { Busy = 1, UnknownRecipe = 2, NoStation = 3, MissingIngredients = 4, InventoryFull = 5, Cancelled = 6 }
export const enum Vital { Hunger = 1, Thirst = 2, Stamina = 3 }
export const enum DayPhase { Night = 0, Dawn = 1, Day = 2, Dusk = 3 }

export const ItemGathered = defineEvent<{ entity: Entity; node: Entity; item: number; count: number }>("gameplay.ItemGathered");
export const GatherSwing = defineEvent<{ entity: Entity; node: Entity }>("gameplay.GatherSwing");
export const GatherFailed = defineEvent<{ entity: Entity; node: Entity; reason: GatherFail }>("gameplay.GatherFailed");
export const NodeDepleted = defineEvent<{ node: Entity; kind: number }>("gameplay.NodeDepleted");
export const NodeRespawned = defineEvent<{ node: Entity; kind: number }>("gameplay.NodeRespawned");
export const InventoryOverflow = defineEvent<{ entity: Entity; item: number; lost: number }>("gameplay.InventoryOverflow");
export const CraftStarted = defineEvent<{ entity: Entity; recipe: number; totalTicks: number }>("gameplay.CraftStarted");
export const CraftCompleted = defineEvent<{ entity: Entity; recipe: number; item: number; count: number }>("gameplay.CraftCompleted");
export const CraftFailed = defineEvent<{ entity: Entity; recipe: number; reason: CraftFail }>("gameplay.CraftFailed");
export const ItemConsumed = defineEvent<{ entity: Entity; item: number }>("gameplay.ItemConsumed");
export const VitalDepleted = defineEvent<{ entity: Entity; vital: Vital }>("gameplay.VitalDepleted");
export const Died = defineEvent<{ entity: Entity; cause: DamageCause }>("gameplay.Died");
export const WeatherChanged = defineEvent<{ from: WeatherKind; to: WeatherKind; intensity: number; ticks: number }>("gameplay.WeatherChanged");
export const DayPhaseChanged = defineEvent<{ phase: DayPhase; day: number }>("gameplay.DayPhaseChanged");
