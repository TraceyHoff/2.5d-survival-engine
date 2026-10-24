/**
 * Per-type vehicle size vs the player (pure). Characters are drawn ~2x taller than a literal 1 tile = 1 m projection
 * (body frame 48x80, ~74 px pivot-to-head = a 1.8 m player = 4.6 z units at 16 px/z), so vehicles built at literal
 * height (car roof 1.3 z = 21 px) read flattened next to a player. Vehicles therefore use a STYLIZED height: the roof as
 * a multiple of player height (bike < car < pickup < van/camper < semi), while length/width stay the gameplay footprint
 * (core defs, 1 tile = 1 m, already real-world). Seat z anchors scale with the same factor.
 * TODO(core): move `heightX` into vehicles.json (renderHeight) once gameplay wants it; render keeps this table until then.
 */
import type { VehicleRenderDef } from "./layout.js";

export const PLAYER_HEIGHT_PX = 74;
export const Z_PX = 16;
export const PLAYER_HEIGHT_Z = PLAYER_HEIGHT_PX / Z_PX;

/** Roof height in player heights, by def id (falls back to VEHICLE_CLASS_HEIGHT_X). */
export const VEHICLE_HEIGHT_X: Readonly<Record<string, number>> = {
  bike_basic: 0.62, bike_road: 0.62, bike_mountain: 0.64, bike_bmx: 0.5, bike_fat_tire: 0.64, bike_cruiser: 0.62, bike_tandem: 0.62, bike_cargo: 0.66, bike_trike: 0.62,
  car_compact: 1.2, car_sedan: 1.28, car_muscle: 1.2, car_offroad: 1.45, car_wagon: 1.3,
  truck_pickup: 1.5, truck_flatbed: 1.6, truck_box: 2.1,
  van_cargo: 1.7, van_passenger: 1.65,
  camper_van: 1.85, camper_rv: 2.1,
  semi_tractor: 2.3,
  trailer_utility_small: 0.75, trailer_cargo_medium: 1.5, trailer_flatbed_large: 0.9, trailer_livestock: 1.75, trailer_tanker: 1.9, trailer_camper: 1.8,
  semi_trailer_box: 2.4, semi_trailer_flatbed: 1.0,
};
export const VEHICLE_CLASS_HEIGHT_X: Readonly<Record<string, number>> = { bicycle: 0.62, car: 1.28, truck: 1.6, van: 1.7, camper: 2.0, semi: 2.3, trailer: 1.5 };

export function heightX(d: Pick<VehicleRenderDef, "id" | "class">): number { return VEHICLE_HEIGHT_X[d.id] ?? VEHICLE_CLASS_HEIGHT_X[d.class] ?? 1.3; }
export function targetHeightPx(d: Pick<VehicleRenderDef, "id" | "class">): number { return heightX(d) * PLAYER_HEIGHT_PX; }
export function targetHeightZ(d: Pick<VehicleRenderDef, "id" | "class">): number { return targetHeightPx(d) / Z_PX; }
/** Target side-view size of a vehicle sprite in 1x px (length along the E/W view: 45.25 px per tile; height above the pivot). */
export function targetSpritePx(d: VehicleRenderDef): { length: number; width: number; height: number } {
  const t = 32 * Math.SQRT2; return { length: Math.round(d.footprint.length * t), width: Math.round(d.footprint.width * t), height: Math.round(targetHeightPx(d)) };
}

/**
 * Measured pivot-to-top heights (1x px, E view) of Art's d40bc37 vehicle sprites (packages/assets/pack/vehicles; opaque
 * bbox). Used to scale each sprite so its roof hits targetHeightPx; unknown keys fall back to 0.8 * anchor.y * frameH.
 */
export const ART_HEIGHT_PX: Readonly<Record<string, number>> = {
  bike_road: 43, bike_mountain: 48, bike_bmx: 35, trailer_utility: 48, bike_cargo: 45, bike_tandem: 45, car_sedan: 52, car_hatchback: 54,
  car_sports: 45, car_suv: 69, car_pickup: 60, van_minivan: 68, van_delivery: 73, truck_box: 93, truck_semi_cab: 97, camper_trailer: 73,
  camper_motorhome: 82, trailer_flatbed: 41, trailer_box: 95, trailer_tanker: 69, trailer_log: 62,
};
/** Measured side-view lengths (1x px, E view) of the same sprites. */
export const ART_LENGTH_PX: Readonly<Record<string, number>> = {
  bike_road: 86, bike_mountain: 86, bike_bmx: 70, trailer_utility: 94, bike_cargo: 113, bike_tandem: 120, car_sedan: 111, car_hatchback: 99,
  car_sports: 117, car_suv: 120, car_pickup: 125, van_minivan: 125, van_delivery: 130, truck_box: 153, truck_semi_cab: 138, camper_trailer: 128,
  camper_motorhome: 140, trailer_flatbed: 189, trailer_box: 196, trailer_tanker: 196, trailer_log: 189,
};
/** Sprite scale for an Art key so its roof matches the def's target height. */
export function artScaleFor(d: VehicleRenderDef, artKey: string, fallbackPx?: number): number {
  const h = ART_HEIGHT_PX[artKey] ?? fallbackPx; if (!h || h <= 0) return 1;
  return Math.min(4, Math.max(0.5, targetHeightPx(d) / h));
}
/** Vertical factor applied to vehicles.json seat z (authored for the literal ~1.3 z car roof) under the stylized height. */
export function seatZScale(d: VehicleRenderDef, literalRoofZ: number): number { return literalRoofZ > 0 ? targetHeightZ(d) / literalRoofZ : 1; }
