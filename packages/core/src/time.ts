import { TimeOfDay } from "./builtins.js";
import type { World } from "./world.js";

export interface TimeOfDayInfo {
  /** Fraction of the day in [0, 1). */
  t: number;
  /** Hours in [0, 24). */
  hours: number;
  /** Whole days elapsed since the epoch (may be negative before it). */
  day: number;
  /** Tick within the current day, [0, dayLengthTicks). */
  tickOfDay: number;
  dayLengthTicks: number;
}
/** Derived time of day at `tick` (default world.tick). dayLengthTicks 0 (uninitialised) reports t = 0, day 0. */
export function timeOfDay(world: World, tick = world.tick): TimeOfDayInfo {
  const tod = world.env(TimeOfDay); const len = tod.dayLengthTicks;
  if (len <= 0) return { t: 0, hours: 0, day: 0, tickOfDay: 0, dayLengthTicks: 0 };
  const elapsed = tick - tod.epochTick; const day = Math.floor(elapsed / len); const tickOfDay = elapsed - day * len;
  const t = tickOfDay / len;
  return { t, hours: t * 24, day, tickOfDay, dayLengthTicks: len };
}
/** Jump to `hours` (0-24) of `day` (default: current day) at the current tick. */
export function setTimeOfDay(world: World, hours: number, day = timeOfDay(world).day): void {
  const tod = world.env(TimeOfDay); const len = tod.dayLengthTicks; if (len <= 0) throw new Error("setTimeOfDay: dayLengthTicks not set");
  const h = ((hours % 24) + 24) % 24;
  tod.epochTick = world.tick - (day * len + Math.round((h / 24) * len));
}
/** Change day length, keeping the current fraction of day and day number. */
export function setDayLength(world: World, dayLengthTicks: number): void {
  if (!(Number.isInteger(dayLengthTicks) && dayLengthTicks > 0)) throw new Error("dayLengthTicks must be a positive integer");
  const cur = timeOfDay(world); const tod = world.env(TimeOfDay);
  tod.dayLengthTicks = dayLengthTicks;
  tod.epochTick = world.tick - (cur.day * dayLengthTicks + Math.round(cur.t * dayLengthTicks));
}
