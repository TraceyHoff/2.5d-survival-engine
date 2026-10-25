/**
 * Camper station view-model + intents (assets/ui/screens/camper_station.md; client gameplay-panels.ts "camper" panel).
 * Opened on VehicleStationOpened (server mirrors it to the owner as the gameplay.vehicleStationOpened net event).
 * Uses the existing flows only: crafting/cooking = queueCraft (interior stations count as workbench/campfire while
 * parked, nearbyVehicleStationKinds), fuel = vehicleRefuel, storage = the vehicle's Container (openContainer/withdraw).
 * Pure reads, browser-safe; server handlers re-validate.
 */
import type { Entity } from "@engine/core";
import { Container, Vehicle } from "../components.js";
import { gameplayDefs } from "../config.js";
import { StationKind } from "../defs.js";
import { listSlots } from "../inventory.js";
import { CloseContainerCmd, OpenContainerCmd } from "../input.js";
import { fuelFits, VehicleRefuelCmd } from "../vehicle_craft.js";
import { isParked, vehicleDefOf, vehicleStations } from "../vehicles.js";
import { craftingView, type MenuCtx, type MenuIntent, type QueueJobView, type RecipeView } from "./menus.js";

export interface CamperSlotView { slot: number; item: number; icon: string; name: string; count: number }
export interface CamperRecipeView extends RecipeView { icon: string }
export interface CamperJobView extends QueueJobView { icon: string }
export interface CamperStationView {
  vehicle: Entity; name: string; parked: boolean;
  /** fuel tank: fraction 0..1, liters, capacity, seconds of full-throttle driving left; low = below 15% */
  fuel: { fraction: number; liters: number; capacity: number; seconds: number; low: boolean; uses: boolean };
  /** first inventory stack that fits this vehicle's tank (undefined = none carried) */
  fuelItem: CamperSlotView | undefined;
  craft: CamperRecipeView[]; cook: CamperRecipeView[]; craftJobs: CamperJobView[]; cookJobs: CamperJobView[];
  storage: { slots: (CamperSlotView | { slot: number; item: 0 })[]; used: number; total: number; visible: boolean };
}
export const CAMPER_FUEL_LOW = 0.15;

export function camperStationView(c: MenuCtx, vehicle: Entity): CamperStationView | undefined {
  const w = c.world; if (!w.isAlive(vehicle) || !w.has(vehicle, Vehicle)) return undefined;
  const d = vehicleDefOf(w, vehicle); if (!d) return undefined; const defs = gameplayDefs(w);
  const icon = (item: number): string => defs.items.get(item)?.spriteKey ?? "";
  const name = (item: number): string => defs.items.get(item)?.name ?? "";
  const kinds = new Set(vehicleStations(w, vehicle).map((s) => s.kind as number));
  const liters = w.getField(vehicle, Vehicle, "fuel") ?? 0; const cap = d.fuel?.capacity ?? 0;
  const fraction = cap > 0 ? Math.max(0, Math.min(1, liters / cap)) : 0;
  const fs = listSlots(w, c.player).find((s) => s.count > 0 && fuelFits(w, vehicle, s.item));
  const cv = craftingView(c, -1);
  const withIcon = (r: RecipeView): CamperRecipeView => ({ ...r, icon: icon(r.output.item) });
  const station = new Map(cv.recipes.map((r) => [r.id, r.station]));
  const jobs = cv.queue.map((j) => ({ ...j, icon: icon(defs.recipes.get(j.recipe)?.output.item ?? 0) }));
  const isCook = (st: number | undefined): boolean => st === StationKind.Campfire;
  const storage: CamperStationView["storage"] = { slots: [], used: 0, total: 0, visible: w.has(vehicle, Container) };
  if (storage.visible) {
    const total = w.getField(vehicle, Container, "slotCount") ?? 0; const filled = new Map(listSlots(w, vehicle).map((s) => [s.slot, s]));
    storage.total = total; storage.used = filled.size;
    for (let i = 0; i < total; i++) { const s = filled.get(i); storage.slots.push(s ? { slot: i, item: s.item, icon: icon(s.item), name: name(s.item), count: s.count } : { slot: i, item: 0 }); }
  }
  return {
    vehicle, name: d.id.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()), parked: isParked(w, vehicle),
    fuel: { fraction, liters, capacity: cap, seconds: d.fuel && d.fuel.perSecond > 0 ? liters / d.fuel.perSecond : 0, low: !!d.fuel && fraction < CAMPER_FUEL_LOW, uses: !!d.fuel },
    fuelItem: fs ? { slot: fs.slot, item: fs.item, icon: icon(fs.item), name: name(fs.item), count: fs.count } : undefined,
    craft: cv.recipes.filter((r) => r.station !== StationKind.None && !isCook(r.station) && kinds.has(r.station)).map(withIcon),
    cook: kinds.has(StationKind.Campfire) ? cv.recipes.filter((r) => isCook(r.station)).map(withIcon) : [],
    craftJobs: jobs.filter((j) => !isCook(station.get(j.recipe))), cookJobs: jobs.filter((j) => isCook(station.get(j.recipe))),
    storage,
  };
}
const ent = (cmd: MenuIntent["cmd"], args: MenuIntent["args"]): MenuIntent => ({ cmd, args, entities: ["target"] });
export const vehicleRefuelIntent = (vehicle: Entity, slot: number, count = 1): MenuIntent => ent(VehicleRefuelCmd, { target: vehicle, slot, count });
export const openContainerIntent = (target: Entity): MenuIntent => ent(OpenContainerCmd, { target });
export const closeContainerIntent = (): MenuIntent => ({ cmd: CloseContainerCmd, args: {} });
