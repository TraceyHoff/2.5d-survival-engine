/**
 * ADR-239 HUD temperature gauge: pure helpers (unit setting, formatting, gauge position, colour band) so the HUD row and
 * its tests share one model. The air temperature is the replicated season + time of day + weather + daily-noise model
 * (gameplay seasonalTemperature) evaluated on the client's server-tick day clock, so every peer reads the same number.
 */
import { seasonAtDays, Weather, type World } from "@engine/core";
import { gameplayDefs, seasonalTemperature, shelterAt, shelterTempShift } from "@engine/gameplay";

export type TempUnit = "C" | "F";
const SETTINGS_KEY = "engine-settings"; // menu.ts Settings (tempUnit)
/** Settings → Temperature (ADR-243: default °F, °C only when chosen). */
export function loadTempUnit(): TempUnit {
  // ADR-243: °F default; °C only when explicitly chosen (mirrors menu.ts resolveTempUnit, kept dependency-free for the HUD)
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { tempUnit?: string; tempUnitChosen?: boolean }; return s.tempUnit === "C" && s.tempUnitChosen === true ? "C" : "F"; } catch { return "F"; }
}
export const toF = (c: number): number => c * 9 / 5 + 32;
/** "24°C" / "75°F" (rounded; "−" minus sign so negatives read cleanly in Fredoka). */
export function formatTemp(c: number, unit: TempUnit = "F"): string {
  const v = Math.round(unit === "F" ? toF(c) : c); return `${v < 0 ? "−" : ""}${Math.abs(v)}°${unit}`;
}
/** Gauge scale (deg C) - covers winter blizzard nights to summer heat waves. */
export const GAUGE_MIN = -20, GAUGE_MAX = 40;
/** 0..1 marker position on the gauge. */
export const gaugeFrac = (c: number): number => Math.max(0, Math.min(1, (c - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
/** Comfort band: "cold" below 8 °C, "hot" above 32 °C (matches gameplay vitals comfort band). */
export function tempBand(c: number): "cold" | "mild" | "hot" { return c < 8 ? "cold" : c > 32 ? "hot" : "mild"; }
/** Gauge track: blue (freezing) → green (mild) → orange/red (hot), positioned on the same GAUGE_MIN..GAUGE_MAX scale. */
export const GAUGE_GRADIENT = `linear-gradient(90deg,#5B8FE0 0%,#8FD0F0 ${Math.round(gaugeFrac(0) * 100)}%,#9BD36A ${Math.round(gaugeFrac(12) * 100)}%,#F4D35A ${Math.round(gaugeFrac(26) * 100)}%,#F08A3C ${Math.round(gaugeFrac(32) * 100)}%,#D9423A 100%)`;
export const SEASON_LABEL = ["Summer", "Fall", "Winter", "Spring"] as const;

/** Air temperature (deg C) the server model gives at `days` (continuous, server-tick day count). */
export function hudAirTemp(w: World, days: number, weatherKind?: number): number {
  const env = gameplayDefs(w).environment; const wx = w.env(Weather);
  const day = Math.floor(days), t = days - day;
  return seasonalTemperature(env, seasonAtDays(w, days), { t, hours: t * 24, day, tickOfDay: 0, dayLengthTicks: 1 }, { kind: weatherKind ?? wx.kind, intensity: weatherKind !== undefined ? 1 : wx.intensity });
}

/**
 * Task 23: the air temperature where the player stands, on the HUD's server-tick day clock (same model as
 * hudAirTemp): outdoor air pulled by shelter (roof + walls), clamped to the comfort band in a fully enclosed
 * room. Without shelter data the world reports open sky and this is just the air temperature.
 */
export function hudShelteredTemp(w: World, days: number, x: number, y: number, z = 0, weatherKind?: number, fireHeat = 0): { temp: number; sheltered: boolean; enclosed: boolean } {
  const air = hudAirTemp(w, days, weatherKind);
  const env = gameplayDefs(w).environment; const vt = gameplayDefs(w).vitals;
  const sh = shelterAt(w, x, y, z, w.env(Weather).windDir);
  const t = air + shelterTempShift(sh, air, vt, env.shelterTempBonus);
  const enclosed = sh.exposure === 0;
  // Task 24: inside an enclosed room the gauge shows the room's smoothed fire heat on top of the clamped base.
  return { temp: enclosed ? Math.min(vt.comfortMax, Math.max(vt.comfortMin, t)) + fireHeat : t, sheltered: sh.exposure < 1, enclosed };
}
