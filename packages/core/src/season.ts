/**
 * ADR-239 seasons: a Summer -> Fall -> Winter cycle derived from the day clock (TimeOfDay), so it is server-authoritative,
 * persisted (the clock's epoch + `offsetDays` in world meta) and replicated (Season + TimeOfDay are networked env
 * components) with no per-tick state. `lengthDays` = in-game days per season (0 = seasons off: always summer);
 * `offsetDays` shifts the cycle (admin / dev jump, tests); `blendDays` = the tail of each season over which visuals and
 * temperature blend smoothly into the next one.
 */
import { defineComponent } from "./component.js";
import { timeOfDay } from "./time.js";
import type { World } from "./world.js";

export const Season = defineComponent("Season", { lengthDays: "u16", offsetDays: "i32", blendDays: "f32" }, { networked: true });

/** Season ids (stable, renderer / HUD contract). */
export const enum SeasonId { Summer = 0, Fall = 1, Winter = 2 }
export const SEASON_NAMES = ["summer", "fall", "winter"] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];
export const SEASON_COUNT = 3;

export interface SeasonInfo {
  /** Current season 0 summer, 1 fall, 2 winter. */
  index: number;
  /** Season it blends into. */
  next: number;
  /** 0..1 smooth blend toward `next` (only inside the last blendDays of the season). */
  blend: number;
  /** Days into the current season (fractional) and its length. */
  into: number; lengthDays: number;
  /** Weights per season (sum 1): [summer, fall, winter]. */
  weights: [number, number, number];
  /** Whole cycles (years) since the epoch. */
  year: number;
}

const OFF: SeasonInfo = { index: 0, next: 0, blend: 0, into: 0, lengthDays: 0, weights: [1, 0, 0], year: 0 };

function hasSeason(world: World): boolean {
  return world.isAlive(world.environment) && world.isRegistered(Season) && world.has(world.environment, Season);
}

/** Pure season math from a (fractional) day position. */
export function seasonFromDays(days: number, lengthDays: number, blendDays: number): SeasonInfo {
  if (!(lengthDays > 0)) return { ...OFF, weights: [1, 0, 0] };
  const cycle = lengthDays * SEASON_COUNT;
  const p = ((days % cycle) + cycle) % cycle;
  const index = Math.min(SEASON_COUNT - 1, Math.floor(p / lengthDays));
  const into = p - index * lengthDays;
  const next = (index + 1) % SEASON_COUNT;
  const b = Math.max(0, Math.min(lengthDays, blendDays));
  let blend = 0;
  if (b > 0 && into > lengthDays - b) { const x = (into - (lengthDays - b)) / b; blend = x * x * (3 - 2 * x); }
  const weights: [number, number, number] = [0, 0, 0]; weights[index] = 1 - blend; weights[next] = weights[next]! + blend;
  return { index, next, blend, into, lengthDays, weights, year: Math.floor(days / cycle) };
}

/** Season at `tick` (default now). Always summer when the world has no Season or lengthDays 0. */
export function seasonAt(world: World, tick = world.tick): SeasonInfo {
  if (!hasSeason(world)) return { ...OFF, weights: [1, 0, 0] };
  const s = world.env(Season); const tod = timeOfDay(world, tick);
  if (tod.dayLengthTicks <= 0) return { ...OFF, weights: [1, 0, 0] };
  return seasonFromDays(tod.day + tod.t + s.offsetDays, s.lengthDays, s.blendDays);
}

/**
 * Season at a fractional day position (`days` = day + t since the clock epoch). Clients use this with their server-tick
 * day clock (ADR-115): the client World's own tick is not the server's.
 */
export function seasonAtDays(world: World, days: number): SeasonInfo {
  if (!hasSeason(world)) return { ...OFF, weights: [1, 0, 0] };
  const s = world.env(Season); return seasonFromDays(days + s.offsetDays, s.lengthDays, s.blendDays);
}

/** Jump to `daysInto` days into `season` (keeps the time of day): adjusts offsetDays only. */
export function setSeason(world: World, season: number, daysInto = 0): void {
  const s = world.env(Season); if (!(s.lengthDays > 0)) return;
  const tod = timeOfDay(world);
  const target = ((season % SEASON_COUNT) + SEASON_COUNT) % SEASON_COUNT * s.lengthDays + Math.max(0, Math.floor(daysInto));
  const cycle = s.lengthDays * SEASON_COUNT;
  s.offsetDays = (((target - tod.day) % cycle) + cycle) % cycle;
}

/** Stable per-day noise in [-1, 1] (same on server and every client: depends only on the day number). */
export function dayNoise(day: number, salt = 0): number {
  let h = Math.imul((day | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
