/**
 * Thin interfaces over the Engine Architect's upcoming generic realism support (Emitter/EmitterIndex,
 * BuildingGrid isCovered/enclosure/exposure, Weather.windDir/windSpeed, climateAt/ClimateModel, addSystem every/offset,
 * decayAt, modifier stacks). Gameplay owns the RULES; until the core/world code lands these adapters provide the
 * same answers from gameplay state. Swap each adapter body for the core call when it arrives (signatures pending).
 */
import { Weather, type World } from "@engine/core";
import { WeatherKind, type PieceDef } from "./defs.js";

/** Emitter kind ids (gameplay-defined, reported to Render/Engine). Append only. */
export const enum EmitterKind { Heat = 1, Light = 2 }
export interface EmitterSpec { readonly kind: EmitterKind; readonly radius: number; readonly strength: number; /** 0 linear, 1 quadratic */ readonly falloff: number }
/** Emitters a fire/light piece carries (attached to its fire entity as core Emitter once it lands). */
export function emitterSpecs(def: PieceDef): EmitterSpec[] {
  const out: EmitterSpec[] = [];
  if (def.heat > 0) out.push({ kind: EmitterKind.Heat, radius: def.heatRadius, strength: def.heat, falloff: 0 });
  if (def.light) out.push({ kind: EmitterKind.Light, radius: Math.max(def.heatRadius * 2, 4), strength: 1, falloff: 1 });
  return out;
}

/** Wind (tiles/s-ish 0..1 scale). Reads core Weather.windSpeed when present, else a per-kind default. */
const WIND_DEFAULT: Record<number, number> = { [WeatherKind.Clear]: 0.2, [WeatherKind.Rain]: 0.4, [WeatherKind.Storm]: 1, [WeatherKind.Snow]: 0.5, [WeatherKind.Fog]: 0.05 };
export function windSpeed(world: World): number {
  const w = world.env(Weather) as unknown as Record<string, number>;
  return typeof w.windSpeed === "number" ? w.windSpeed : (WIND_DEFAULT[w.kind ?? 0] ?? 0.2) * (w.intensity ?? 1);
}
export const isRaining = (kind: number): boolean => kind === WeatherKind.Rain || kind === WeatherKind.Storm;
