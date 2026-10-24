/**
 * Environment rules on top of core/world mechanisms:
 *  - clock: DayPhaseChanged from core's derived TimeOfDay;
 *  - weather: authority state machine on core Weather (kind, intensity, endsAtTick, windDir, windSpeed);
 *  - climate: GameplayClimateModel registered with world installClimate (temperature curve lives here);
 *  - exposure (every 4 ticks = 5 Hz): heat from the world EmitterIndex (sampleField, walls occlude), shelter from
 *    BuildingGrid isCovered/exposure + edge-wall enclosure, wetness, felt temperature, buff modifiers;
 *  - chunk surface wetness (every 20 ticks): rises with rain, dries with wind and sun.
 * WeatherKind values are stable (renderer contract): 0 Clear, 1 Rain, 2 Storm, 3 Snow, 4 Fog.
 */
import { addModifier, entityIndex, ModOp, timeOfDay, Transform, Weather, type Entity, type World } from "@engine/core";
import { ClimateRes, climateAt, EmitterIndexRes, type BaseClimate, type ClimateContext, type ClimateModel, type ClimateSample } from "@engine/world";
import { Buffs, ChunkSurface, Exposure, Stat, Wetness } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks, WeatherKind, type EnvironmentTuning, type WeatherDef } from "../defs.js";
import { DayPhase, DayPhaseChanged, emit, WeatherChanged } from "../events.js";
import { EmitterKind, isRaining } from "../realism.js";
import { shelterAt } from "../building/shelter.js";
import { waterproofOf } from "../combat/arms.js";

export const EXPOSURE_EVERY = 4;
export const SURFACE_EVERY = 20;

export function dayPhase(t: number): DayPhase {
  if (t < 0.2 || t >= 0.85) return DayPhase.Night;
  if (t < 0.3) return DayPhase.Dawn;
  if (t < 0.75) return DayPhase.Day;
  return DayPhase.Dusk;
}

/** Time of day is derived from world.tick (core timeOfDay); this only emits phase changes. */
export function clockSystem(world: World): void {
  const before = timeOfDay(world, world.tick), after = timeOfDay(world, world.tick + 1);
  if (after.dayLengthTicks === 0) return;
  const pa = dayPhase(after.t);
  if (pa !== dayPhase(before.t)) emit(world, DayPhaseChanged, { phase: pa, day: after.day });
}

const NEUTRAL: WeatherDef = { kind: WeatherKind.Clear, weight: 0, durationSeconds: [0, 0], intensity: [0, 0], tempOffset: 0, wetnessPerSec: 0, thirstMul: 1, staminaRegenMul: 1, windSpeed: [0, 0] };
export function weatherDef(env: EnvironmentTuning, kind: WeatherKind): WeatherDef {
  return env.weather.find((w) => w.kind === kind) ?? NEUTRAL;
}

/** Authoritative weather state machine (world.rng, server only; clients receive Weather by replication). */
export function weatherSystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const w = world.env(Weather);
  if (world.tick < w.endsAtTick) return;
  const env = gameplayDefs(world).environment;
  const def = env.weather[weightedIndex(world, env.weather.map((d) => d.weight))]!;
  const from = w.kind as WeatherKind;
  w.kind = def.kind;
  w.intensity = world.rng.range(def.intensity[0], def.intensity[1]);
  w.windSpeed = world.rng.range(def.windSpeed[0], def.windSpeed[1]);
  w.windDir = world.rng.range(-Math.PI, Math.PI);
  const ticks = secondsToTicks(world.rng.range(def.durationSeconds[0], def.durationSeconds[1]), dt);
  w.endsAtTick = world.tick + ticks + 1;
  emit(world, WeatherChanged, { from, to: def.kind, intensity: w.intensity, ticks });
}

function weightedIndex(world: World, weights: readonly number[]): number {
  let total = 0; for (const x of weights) total += Math.max(0, x);
  let r = world.rng.next() * total;
  for (let i = 0; i < weights.length; i++) { r -= Math.max(0, weights[i]!); if (r < 0) return i; }
  return weights.length - 1;
}

/** Gameplay temperature/humidity curves for world climateAt: base(biome band, altitude) + day/night + weather. */
export function gameplayClimateModel(env: EnvironmentTuning): ClimateModel {
  return {
    sample(b: BaseClimate, ctx: ClimateContext): ClimateSample {
      const curve = -Math.cos(2 * Math.PI * ctx.time.t); // -1 midnight, +1 noon
      const wd = weatherDef(env, ctx.weather.kind as WeatherKind);
      return {
        temperature: b.temperature + env.dayNightAmplitude * curve + wd.tempOffset * ctx.weather.intensity - env.altitudeLapse * b.altitude,
        humidity: Math.min(1, b.humidity + env.humidityPerIntensity * (wd.wetnessPerSec > 0 ? ctx.weather.intensity : 0)),
        altitude: b.altitude, windDir: ctx.weather.windDir, windSpeed: ctx.weather.windSpeed,
        weatherKind: ctx.weather.kind, weatherIntensity: ctx.weather.intensity,
      };
    },
  };
}

/** Air temperature (deg C) at a position: world climate if installed, else baseTemp through the same model. */
export function ambientTemperature(world: World, x = 0, y = 0): number {
  if (world.getResource(ClimateRes)) return climateAt(world, x, y).temperature;
  const env = gameplayDefs(world).environment; const w = world.env(Weather);
  return gameplayClimateModel(env).sample({ temperature: env.baseTemp, humidity: 0.5, altitude: 0 }, {
    time: timeOfDay(world), x, y, weather: { kind: w.kind, intensity: w.intensity, windDir: w.windDir, windSpeed: w.windSpeed },
  }).temperature;
}

/** Spawn-pressure multiplier (night). */
export function threatLevel(world: World): number {
  return dayPhase(timeOfDay(world).t) === DayPhase.Night ? gameplayDefs(world).environment.nightThreatMul : 1;
}

/** Heat (deg C) at a position from Heat emitters (lit fires), walls occlude. */
export function heatAt(world: World, x: number, y: number, z = 0): number {
  return world.getResource(EmitterIndexRes)?.sampleField(EmitterKind.Heat, x, y, z) ?? 0;
}

/**
 * Per entity, every EXPOSURE_EVERY ticks (dt = dt x every): wetness, felt temperature, buffs.
 * Deterministic from replicated state, so the owning client may run it for prediction.
 */
export function exposureSystem(world: World, dt: number): void {
  const defs = gameplayDefs(world); const env = defs.environment; const vt = defs.vitals;
  const w = world.env(Weather); const wdef = weatherDef(env, w.kind as WeatherKind);
  const tf = world.store(Transform); const ex = world.store(Exposure);
  const expires = world.tick + EXPOSURE_EVERY * 2 + 1;
  for (const e of world.query([Exposure, Transform])) {
    const idx = entityIndex(e); const s = ex.slot(idx); const ts = tf.slot(idx);
    const x = tf.data.x[ts]!, y = tf.data.y[ts]!, z = tf.data.z[ts]!;
    const heat = heatAt(world, x, y, z);
    const sh = shelterAt(world, x, y, z, w.windDir);
    let wet = ex.data.wetness[s]!;
    if (wdef.wetnessPerSec > 0 && sh.exposure > 0) wet += wdef.wetnessPerSec * w.intensity * sh.exposure * (1 - waterproofOf(world, e)) * dt;
    else wet -= env.dryPerSec * (heat > 0 ? env.heatDryMul : 1) * dt;
    wet = Math.min(1, Math.max(0, wet));
    const ambient = ambientTemperature(world, x, y);
    const felt = ambient + ex.data.insulation[s]! + (1 - sh.exposure) * env.shelterTempBonus + heat
      - env.wetChill * wet - env.windChillPerSpeed * Math.sqrt(Math.max(0, w.windSpeed)) * sh.exposure;
    ex.data.wetness[s] = wet; ex.data.feltTemp[s] = felt; ex.data.sheltered[s] = sh.covered ? 1 : 0; ex.markChanged(idx);

    // render-facing wetness (only write on change)
    const lvl = Math.round(wet * 255);
    if (world.getField(e, Wetness, "level") === undefined) world.add(e, Wetness, { level: lvl });
    else if (world.getField(e, Wetness, "level") !== lvl) world.setField(e, Wetness, "level", lvl);

    // buffs: one Mul per stat, refreshed while the condition holds and lapsing on their own otherwise
    const thirst = wdef.thirstMul * (felt > vt.comfortMax ? vt.heatThirstMul : 1);
    const hunger = felt < vt.comfortMin ? vt.coldHungerMul : 1;
    const regen = (sh.covered ? 1 : wdef.staminaRegenMul) * (wet >= env.wetBuffThreshold ? 0.9 : 1);
    setMul(world, e, Stat.ThirstRate, thirst, expires);
    setMul(world, e, Stat.HungerRate, hunger, expires);
    setMul(world, e, Stat.StaminaRegen, regen, expires);
  }
}
function setMul(world: World, e: Entity, stat: Stat, value: number, expiresAtTick: number): void {
  addModifier(world, e, Buffs, { stat, op: ModOp.Mul, value, expiresAtTick });
}

/** Per-chunk surface wetness 0..1 (u8), authority, every SURFACE_EVERY ticks. */
export function chunkSurfaceSystem(world: World, dt: number): void {
  if (!isAuthority(world)) return;
  const env = gameplayDefs(world).environment; const w = world.env(Weather);
  const curve = -Math.cos(2 * Math.PI * timeOfDay(world).t);
  const sun = w.kind === WeatherKind.Clear ? Math.max(0, curve) : 0;
  const rain = isRaining(w.kind) ? env.surface.rainPerSec * w.intensity : 0;
  const dry = env.surface.dryPerSec * (1 + env.surface.windDryMul * w.windSpeed + env.surface.sunDryMul * sun);
  const delta = (rain - (rain > 0 ? 0 : dry)) * dt;
  if (delta === 0) return;
  const st = world.store(ChunkSurface);
  for (let k = 0; k < st.size; k++) {
    const cur = st.data.wetness[k]! / 255; const next = Math.round(Math.min(1, Math.max(0, cur + delta)) * 255);
    // sub-step accumulation: u8 resolution is 1/255; guarantee progress on slow drying
    const v = next === st.data.wetness[k] && delta !== 0 ? Math.min(255, Math.max(0, next + Math.sign(delta) * (Math.abs(delta) * 255 >= 0.5 ? 1 : 0))) : next;
    if (v !== st.data.wetness[k]) { st.data.wetness[k] = v; st.markChanged(entityIndex(st.dense[k]!)); }
  }
}
