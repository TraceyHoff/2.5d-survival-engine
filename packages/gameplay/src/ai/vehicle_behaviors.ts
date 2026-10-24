/**
 * Bot driving (DESIGN.md §31): SP AI humans use vehicles through the same validated commands as players, emitted as
 * AgentOutput action strings (venter / vexit / vhitch / vrefuel / vrepair / vdeploy -> AgentOutput.commands via
 * agent_output.ts). Driving = moveX/moveY while seated. Reads only the bot's replica (fillVehicleSensors). Trait
 * gates (data/vehicle_crafting.json bots): timid bots (bravery < minBraveryToDrive) never drive; only industrious
 * bots (>= minIndustriousnessToHitch) hitch trailers. Deterministic: no rng, no clock.
 */
import { Transform, type Entity, type World } from "@engine/core";
import type { AgentWorldView, GameBehavior } from "../agents.js";
import { Driver, Hitch, Vehicle } from "../components.js";
import { readSlots } from "../inventory.js";
import { isParked, ridingVehicle, vehicleDefOf, type VehicleClass } from "../vehicles.js";
import { fuelFits, kitVehicle, vehicleMaxHealth, VEHICLE_CRAFT } from "../vehicle_craft.js";
import { gameplayDefs } from "../config.js";

export interface SeenVehicle { id: number; x: number; y: number; cls: VehicleClass; fuel: number; hp: number; parked: boolean; hitched: boolean; canTow: boolean; fuelSlot?: number; repairSlot?: number }
export interface VehicleSensors {
  vehicles?: SeenVehicle[];
  /** Vehicle the bot sits in (driver seat or not). */
  riding?: SeenVehicle & { driver: boolean };
  /** Inventory slot holding a vehicle kit. */
  kitSlot?: number;
  /** Where the bot wants to go (host may set; default clan goal, else home). */
  driveGoal?: { x: number; y: number };
}

function seen(world: World, v: Entity, slots: ReturnType<typeof readSlots> | undefined): SeenVehicle | undefined {
  const d = vehicleDefOf(world, v); const t = world.get(v, Transform); const s = world.get(v, Vehicle); if (!d || !t || !s) return undefined;
  const out: SeenVehicle = { id: v, x: t.x, y: t.y, cls: d.class, fuel: d.fuel ? s.fuel / d.fuel.capacity : 1, hp: d.health ? s.health / d.health : 0, parked: isParked(world, v),
    hitched: (world.getField(v, Hitch, "parentNetId") ?? 0) !== 0, canTow: d.hitches.some((h) => h.at === "rear") && (world.getField(v, Hitch, "towNetId") ?? 0) === 0 };
  if (slots) {
    const defs = gameplayDefs(world);
    for (let i = 0; i < slots.slotCount; i++) {
      const it = slots.item(i); if (!it || !slots.count(i)) continue;
      if (out.fuelSlot === undefined && d.fuel && fuelFits(world, v, it)) out.fuelSlot = i;
      const r = VEHICLE_CRAFT.repair.items[defs.items.get(it)?.key ?? ""];
      if (out.repairSlot === undefined && r && r.field > 0 && (!r.classes.length || r.classes.includes(d.class))) out.repairSlot = i;
    }
  }
  if (out.hp > vehicleMaxHealth(world, v) / (d.health || 1)) out.hp = vehicleMaxHealth(world, v) / (d.health || 1);
  return out;
}

/** Fills vehicle sensors from the replica (no writes). */
export function fillVehicleSensors(world: World, self: Entity, view: AgentWorldView): void {
  const t = world.get(self, Transform); if (!t) return;
  let slots: ReturnType<typeof readSlots> | undefined; try { slots = readSlots(world, self); } catch { slots = undefined; }
  const list: SeenVehicle[] = []; const R = VEHICLE_CRAFT.bots.seekRadius;
  for (const v of world.query([Vehicle, Transform])) { const p = world.get(v, Transform)!; if (Math.hypot(p.x - t.x, p.y - t.y) > R) continue; const s = seen(world, v, slots); if (s) list.push(s); }
  list.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y) || a.id - b.id);
  if (list.length) view.vehicles = list;
  const r = ridingVehicle(world, self);
  if (r !== undefined) { const s = seen(world, r, slots); if (s) view.riding = { ...s, driver: world.getField(self, Driver, "seat") === 0 }; }
  if (slots) for (let i = 0; i < slots.slotCount; i++) if (slots.count(i) && kitVehicle(world, slots.item(i))) { view.kitSlot = i; break; }
  if (!view.driveGoal) view.driveGoal = view.clan?.goal ? { x: view.clan.goalX, y: view.clan.goalY } : view.home;
}

const toward = (o: { moveX: number; moveY: number; aimX: number; aimY: number }, fx: number, fy: number, tx: number, ty: number, s = 1): number => {
  const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy) || 1; o.moveX = (dx / d) * s; o.moveY = (dy / d) * s; o.aimX = dx / d; o.aimY = dy / d; return d;
};
const B = (): typeof VEHICLE_CRAFT.bots => VEHICLE_CRAFT.bots;
const goalDist = (w: AgentWorldView, x: number, y: number): number => (w.driveGoal ? Math.hypot(w.driveGoal.x - x, w.driveGoal.y - y) : 0);
/** Best vehicle to drive: motor with fuel or a bicycle, not wrecked, not a trailer, parked. */
export function pickRide(w: AgentWorldView): SeenVehicle | undefined {
  return w.vehicles?.find((v) => v.cls !== "trailer" && v.parked && v.hp > 0 && (v.cls === "bicycle" || v.fuel > 0.02));
}
const willDrive = (traits: { bravery: number }): boolean => traits.bravery >= B().minBraveryToDrive;
const cooled = (tick: number, at: number, ticks: number): boolean => tick - at >= ticks;

/** drive, vehicle_service (refuel/repair), hitch, deploy_vehicle. */
export function vehicleBehaviors(): GameBehavior[] {
  return [
    { name: "drive", inertia: 0.4, traits: { bravery: 0.4, industriousness: 0.3 }, considerations: [
        { name: "willing", curve: { type: "step", at: 0.5 }, input: (c) => (willDrive(c.traits) ? 1 : 0) },
        { name: "far", curve: { type: "step", at: 0.5 }, input: (c) => (goalDist(c.world, c.self.x, c.self.y) > (c.world.riding ? B().arriveDistance : B().driveMinDistance) ? 1 : 0) },
        { name: "ride", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.riding || pickRide(c.world) ? 1 : 0) }],
      run: (c, o) => {
        const w = c.world; const g = w.driveGoal; if (!g) return false; const r = w.riding;
        if (r) {
          if (!r.driver) { o.actions.push("vexit"); return false; }
          const d = goalDist(w, r.x, r.y);
          if (d <= B().arriveDistance || r.hp <= 0 || (r.cls !== "bicycle" && r.fuel <= 0)) { o.moveX = 0; o.moveY = 0; if (r.parked) { o.actions.push("vexit"); return false; } return; }
          toward(o, r.x, r.y, g.x, g.y, 1); o.sprint = r.cls === "bicycle" ? c.self.stamina > 0.5 : false; return;
        }
        const v = pickRide(w); if (!v) return false;
        if (toward(o, c.self.x, c.self.y, v.x, v.y, 0.9) < 2.5 && cooled(c.self.tick, c.bb.num("enteredAt", -1e9), 20)) { o.moveX = 0; o.moveY = 0; o.actions.push(`venter:${v.id}`); c.bb.set("enteredAt", c.self.tick); }
      } },
    { name: "vehicle_service", traits: { industriousness: 0.5 }, considerations: [
        { name: "need", curve: { type: "step", at: 0.5 }, input: (c) => (serviceTarget(c.world) && cooled(c.self.tick, c.bb.num("servicedAt", -1e9), 40) ? 1 : 0) }],
      run: (c, o) => {
        const w = c.world; if (w.riding) { if (w.riding.parked) o.actions.push("vexit"); return; }
        const t = serviceTarget(w); if (!t) return false;
        if (toward(o, c.self.x, c.self.y, t.v.x, t.v.y, 0.8) > 2.5) return;
        o.moveX = 0; o.moveY = 0; o.actions.push(t.kind === "fuel" ? `vrefuel:${t.v.id}:${t.slot}:${VEHICLE_CRAFT.refuel.maxPerCommand}` : `vrepair:${t.v.id}:${t.slot}`);
        c.bb.set("servicedAt", c.self.tick); return false;
      } },
    { name: "hitch", traits: { industriousness: 0.6 }, considerations: [
        { name: "industrious", curve: { type: "step", at: 0.5 }, input: (c) => (c.traits.industriousness >= B().minIndustriousnessToHitch ? 1 : 0) },
        { name: "wantCargo", curve: { type: "step", at: 0.5 }, input: (c) => ((c.world.invSpaceFree ?? 1) < B().hitchWhenInvFreeBelow && hitchPair(c.world) && cooled(c.self.tick, c.bb.num("hitchedAt", -1e9), 200) ? 1 : 0) }],
      run: (c, o) => {
        const p = hitchPair(c.world); if (!p) return false; if (c.world.riding) { if (c.world.riding.parked) o.actions.push("vexit"); return; }
        if (toward(o, c.self.x, c.self.y, p.trailer.x, p.trailer.y, 0.8) > 2.5) return;
        o.moveX = 0; o.moveY = 0; o.actions.push(`vhitch:${p.trailer.id}:${p.tow.id}`); c.bb.set("hitchedAt", c.self.tick); return false;
      } },
    { name: "deploy_vehicle", traits: { industriousness: 0.4 }, considerations: [
        { name: "hasKit", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.kitSlot !== undefined && !c.world.riding && cooled(c.self.tick, c.bb.num("deployedAt", -1e9), 100) ? 1 : 0) }],
      run: (c, o) => {
        const s = c.world.kitSlot; if (s === undefined) return false; o.moveX = 0; o.moveY = 0;
        o.actions.push(`vdeploy:${s}:${Math.round(c.self.x) + 2}:${Math.round(c.self.y)}:0`); c.bb.set("deployedAt", c.self.tick); return false;
      } },
  ];
}
function serviceTarget(w: AgentWorldView): { v: SeenVehicle; kind: "fuel" | "repair"; slot: number } | undefined {
  for (const v of w.vehicles ?? []) {
    if (!v.parked || v.cls === "trailer" && v.repairSlot === undefined) continue;
    if (v.fuelSlot !== undefined && v.fuel < B().refuelBelow) return { v, kind: "fuel", slot: v.fuelSlot };
    if (v.repairSlot !== undefined && v.hp > 0 && v.hp < B().repairBelow) return { v, kind: "repair", slot: v.repairSlot };
  }
  return undefined;
}
function hitchPair(w: AgentWorldView): { trailer: SeenVehicle; tow: SeenVehicle } | undefined {
  const vs = w.vehicles ?? []; const trailer = vs.find((v) => v.cls === "trailer" && !v.hitched && v.parked); if (!trailer) return undefined;
  const tow = vs.find((v) => v.canTow && v.cls !== "trailer" && v.parked && Math.hypot(v.x - trailer.x, v.y - trailer.y) < 10);
  return tow ? { trailer, tow } : undefined;
}
