import { defineResource, timeOfDay, Weather, type TimeOfDayInfo, type World } from "@engine/core";

/** Static per-tile climate from world generation. */
export interface BaseClimate { /** °C baseline */ temperature: number; /** 0..1 */ humidity: number; /** tiles (from tile height) */ altitude: number }
export interface BaseClimateSource { baseClimate(tx: number, ty: number): BaseClimate }
export interface WeatherState { kind: number; intensity: number; windDir: number; windSpeed: number }
export interface ClimateContext { time: TimeOfDayInfo; weather: WeatherState; x: number; y: number }
export interface ClimateSample extends BaseClimate { windDir: number; windSpeed: number; weatherKind: number; weatherIntensity: number }
/** Gameplay-owned curves combining base climate, time of day and weather. */
export interface ClimateModel { sample(base: BaseClimate, ctx: ClimateContext): ClimateSample }

/** Default model: ±6 °C day/night sine (coldest at midnight), -0.6 °C per altitude tile, weather cools by 3 °C × intensity and adds humidity. */
export const DefaultClimateModel: ClimateModel = {
  sample(b, { time, weather }) {
    const dayCurve = -Math.cos(2 * Math.PI * time.t);
    return {
      temperature: b.temperature + 6 * dayCurve - 0.6 * b.altitude - 3 * weather.intensity,
      humidity: Math.min(1, b.humidity + 0.4 * weather.intensity), altitude: b.altitude,
      windDir: weather.windDir, windSpeed: weather.windSpeed, weatherKind: weather.kind, weatherIntensity: weather.intensity,
    };
  },
};
export interface ClimateConfig { source: BaseClimateSource; model: ClimateModel }
export const ClimateRes = defineResource<ClimateConfig>("Climate");
/** Register the base climate source (e.g. ProceduralGenerator) and an optional gameplay ClimateModel. */
export function installClimate(world: World, source: BaseClimateSource, model: ClimateModel = DefaultClimateModel): void {
  world.setResource(ClimateRes, { source, model });
}
export function setClimateModel(world: World, model: ClimateModel): void { world.resource(ClimateRes).model = model; }
/** Climate at a world position now: base(tile) + model(time of day, environment Weather). */
export function climateAt(world: World, x: number, y: number): ClimateSample {
  const cfg = world.resource(ClimateRes); const w = world.env(Weather);
  return cfg.model.sample(cfg.source.baseClimate(Math.floor(x), Math.floor(y)), {
    time: timeOfDay(world), x, y, weather: { kind: w.kind, intensity: w.intensity, windDir: w.windDir, windSpeed: w.windSpeed },
  });
}
