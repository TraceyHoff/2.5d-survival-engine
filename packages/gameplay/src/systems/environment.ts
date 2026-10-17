/**
 * Environment: drives core's TimeOfDay / Weather resources (authority only for weather) and turns
 * them into per-entity exposure: felt temperature, wetness and vitals multipliers.
 *
 * Order (simulation phase): env.clock -> env.weather -> env.exposure (before vitals).
 */
import { entityIndex, timeOfDay, Transform, Weather, type World } from "@engine/core";
import { WeatherKind } from "../defs.js";
import { Exposure, HeatSource, VitalsModifiers } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks, type EnvironmentTuning, type WeatherDef } from "../defs.js";
import { DayPhase, DayPhaseChanged, WeatherChanged } from "../events.js";

export function dayPhase(t: number): DayPhase {
  if (t < 0.2 || t >= 0.85) return DayPhase.Night;
  if (t < 0.3) return DayPhase.Dawn;
  if (t < 0.75) return DayPhase.Day;
  return DayPhase.Dusk;
}

/** Time of day is derived from world.tick (core timeOfDay, ADR-042); this only emits phase changes for the tick being simulated. */
export function clockSystem(world: World): void {
  const before = timeOfDay(world, world.tick), after = timeOfDay(world, world.tick + 1);
  if (after.dayLengthTicks === 0) return;
  const pa = dayPhase(after.t);
  if (pa !== dayPhase(before.t)) world.events.emit(DayPhaseChanged, { phase: pa, day: after.day });
}

const NEUTRAL: WeatherDef = { kind: WeatherKind.Clear, weight: 0, durationSeconds: [0, 0], intensity: [0, 0], tempOffset: 0, wetnessPerSec: 0, thirstMul: 1, staminaRegenMul: 1 };
export function weatherDef(env: EnvironmentTuning, kind: WeatherKind): WeatherDef {
  return env.weather.find((w) => w.kind === kind) ?? NEUTRAL;
}

/** Authoritative weather state machine on core's Weather resource. Uses world.rng (server only). */
export function weatherSystem(world: World, dt: number): void {
  if (!isAuthority(world)) return; // clients receive Weather by replication (open question N3)
  const w = world.env(Weather);
  if (world.tick < w.endsAtTick) return;
  const env = gameplayDefs(world).environment;
  const pick = weightedIndex(world, env.weather.map((d) => d.weight));
  const def = env.weather[pick]!;
  const from = w.kind;
  w.kind = def.kind;
  w.intensity = world.rng.range(def.intensity[0], def.intensity[1]);
  const ticks = secondsToTicks(world.rng.range(def.durationSeconds[0], def.durationSeconds[1]), dt);
  w.endsAtTick = world.tick + ticks + 1;
  world.events.emit(WeatherChanged, { from, to: w.kind, intensity: w.intensity, ticks });
}

function weightedIndex(world: World, weights: readonly number[]): number {
  let total = 0; for (const x of weights) total += Math.max(0, x);
  let r = world.rng.next() * total;
  for (let i = 0; i < weights.length; i++) { r -= Math.max(0, weights[i]!); if (r < 0) return i; }
  return weights.length - 1;
}

/** Ambient air temperature (deg C): sinusoidal day/night curve + weather offset scaled by intensity. */
export function ambientTemperature(world: World): number {
  const env = gameplayDefs(world).environment;
  const tod = timeOfDay(world); const w = world.env(Weather);
  const curve = -Math.cos(2 * Math.PI * tod.t); // -1 at midnight, +1 at noon
  return env.baseTemp + env.dayNightAmplitude * curve + weatherDef(env, w.kind).tempOffset * w.intensity;
}

/** Spawn-pressure multiplier for a future hostile spawner (design only). */
export function threatLevel(world: World): number {
  return dayPhase(timeOfDay(world).t) === DayPhase.Night ? gameplayDefs(world).environment.nightThreatMul : 1;
}

/** Per entity: wetness, felt temperature, and VitalsModifiers. Runs on both sides (deterministic). */
export function exposureSystem(world: World, dt: number): void {
  const defs = gameplayDefs(world); const env = defs.environment; const vt = defs.vitals;
  const w = world.env(Weather); const wdef = weatherDef(env, w.kind);
  const ambient = ambientTemperature(world);
  const tf = world.store(Transform); const ex = world.store(Exposure); const mods = world.store(VitalsModifiers);
  const heaters = [...world.query([HeatSource, Transform])];
  const hs = world.store(HeatSource);

  for (const e of world.query([Exposure, VitalsModifiers, Transform])) {
    const idx = entityIndex(e); const s = ex.slot(idx); const ts = tf.slot(idx);
    const x = tf.data.x[ts]!, y = tf.data.y[ts]!;
    let heat = 0;
    for (const h of heaters) {
      const hi = entityIndex(h); const hsl = hs.slot(hi); if (hs.data.lit[hsl] === 0) continue;
      const ht = tf.slot(hi); const d = Math.hypot(tf.data.x[ht]! - x, tf.data.y[ht]! - y); const r = hs.data.radius[hsl]!;
      if (d < r) heat += hs.data.heat[hsl]! * (1 - d / r);
    }
    const sheltered = ex.data.sheltered[s]! !== 0;
    let wet = ex.data.wetness[s]!;
    if (!sheltered && wdef.wetnessPerSec > 0) wet += wdef.wetnessPerSec * w.intensity * dt;
    else wet -= env.dryPerSec * (heat > 0 ? env.heatDryMul : 1) * dt;
    wet = Math.min(1, Math.max(0, wet));
    const felt = ambient + ex.data.insulation[s]! + (sheltered ? env.shelterTempBonus : 0) + heat - env.wetChill * wet;
    ex.data.wetness[s] = wet; ex.data.feltTemp[s] = felt; ex.markChanged(idx);

    const ms = mods.slot(idx);
    mods.data.hungerMul[ms] = felt < vt.comfortMin ? vt.coldHungerMul : 1;
    mods.data.thirstMul[ms] = wdef.thirstMul * (felt > vt.comfortMax ? vt.heatThirstMul : 1);
    mods.data.staminaRegenMul[ms] = sheltered ? 1 : wdef.staminaRegenMul;
    mods.markChanged(idx);
  }
}
