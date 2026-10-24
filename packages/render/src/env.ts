/**
 * The ONE place the renderer reads time-of-day / weather from the World.
 * TimeOfDay is tick-derived (core ADR-042: timeOfDay(world)); Weather is a gameplay-written env singleton
 * whose `kind` values are gameplay-defined (mapped to visuals by weather.ts' table with a fallback).
 */
import { TimeOfDay, Weather, timeOfDay, type ComponentDef, type World } from "@engine/core";

function hasEnv(world: World, def: ComponentDef): boolean {
  return world.isAlive(world.environment) && world.has(world.environment, def);
}

/** ADR-115: a host-supplied smoothed day fraction (client DayClock on the server tick) wins over the tick-derived one. */
const dayOverride = new WeakMap<World, number>();
export function setDayFraction(world: World, t: number | undefined): void { if (t === undefined) dayOverride.delete(world); else dayOverride.set(world, t - Math.floor(t)); }
/** Fraction of day in [0,1); 0.5 (noon) when the world has no (initialised) time source. */
export function readDayFraction(world: World): number {
  const o = dayOverride.get(world); if (o !== undefined) return o;
  if (!hasEnv(world, TimeOfDay) || !(world.env(TimeOfDay).dayLengthTicks > 0)) return 0.5;
  return timeOfDay(world).t;
}

/** Weather kind (gameplay-defined u8) + intensity 0..1; clear when absent. */
export function readWeather(world: World): { kind: number; intensity: number } {
  if (!hasEnv(world, Weather)) return { kind: 0, intensity: 0 };
  const w = world.env(Weather);
  return { kind: w.kind, intensity: w.intensity };
}

/** Wind from Weather (dir radians in tile axes, speed tiles/s); speed 0 when absent. */
export function readWind(world: World): { dir: number; speed: number } {
  if (!hasEnv(world, Weather)) return { dir: 0, speed: 0 };
  const w = world.env(Weather) as unknown as Record<string, number>;
  return { dir: w.windDir ?? 0, speed: w.windSpeed ?? 0 };
}
