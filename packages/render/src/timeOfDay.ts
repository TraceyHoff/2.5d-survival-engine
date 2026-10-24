/**
 * Time-of-day -> lighting (ADR-115). Pure function of the day fraction `t` (0..1) and, optionally, the day number
 * (moon phase). Shared by the WebGL2 IsoRenderer and the Canvas2D fallback, so both draw the same curve.
 *
 * Model: a continuous sun elevation curve (degrees, sunrise 06:00 / sunset 18:00, peak SUN_MAX_ELEV at noon,
 * -SUN_MAX_ELEV at midnight). Colours come from DAY_CURVE, a data keyframe table keyed on elevation that spans
 * night (< -18), astronomical (-18..-12), nautical (-12..-6) and civil (-6..0) twilight, golden hour (0..6) and day.
 * Rows are smoothstep-blended (C1, no stepping). Dawn leans pink and dusk orange (DAWN_TINT / DUSK_TINT).
 * Cost: one sin + a <= 10-row scan per frame.
 */
export interface DayLighting {
  hours: number;
  /** Ambient light colour * intensity (linear, 0..1+), multiplied into the scene (moonlight included). */
  ambient: [number, number, number];
  /** Background / clear colour. */
  sky: [number, number, number];
  /** Fog / distance tint for this time of day. */
  fog: [number, number, number];
  /** 0 at night, 1 in full day (continuous in sun elevation). */
  daylight: number;
  /** Screen-space shadow direction (iso px per px of sprite height): follows the sun (the moon at night). */
  shadowDir: [number, number];
  shadowAlpha: number;
  /** Extra warm haze near dawn/dusk (0..1). */
  haze: number;
  /** Sun elevation in degrees (negative below the horizon). */
  sunElevation: number;
  /** Phase name for the elevation (night|astronomical|nautical|civil|golden|day). */
  phase: DayPhase;
  /** 0 in daylight .. 1 in full dark: scales light-pass intensity and bloom for fires/lamps. */
  glow: number;
  /** Moon illumination 0 (new) .. 1 (full) and its contribution to ambient. */
  moon: { illumination: number; light: number };
}
export type DayPhase = "night" | "astronomical" | "nautical" | "civil" | "golden" | "day";

/** Peak solar elevation (degrees). */
export const SUN_MAX_ELEV = 62;
/** One row of the light curve: sun elevation (deg) -> ambient, sky, fog (linear rgb), lights glow (0..1). */
export interface DayCurveKey { elev: number; ambient: [number, number, number]; sky: [number, number, number]; fog: [number, number, number]; glow: number }
/** The light curve as data (ascending elevation). Moonlight is added on top of the night rows. */
export const DAY_CURVE: readonly DayCurveKey[] = [
  { elev: -90, ambient: [0.07, 0.085, 0.17], sky: [0.012, 0.018, 0.05], fog: [0.06, 0.07, 0.13], glow: 1 },    // night
  { elev: -18, ambient: [0.08, 0.095, 0.19], sky: [0.016, 0.022, 0.06], fog: [0.07, 0.08, 0.15], glow: 1 },    // astronomical twilight starts
  { elev: -12, ambient: [0.11, 0.12, 0.24], sky: [0.03, 0.04, 0.11], fog: [0.10, 0.11, 0.2], glow: 0.95 },     // nautical
  { elev: -6, ambient: [0.22, 0.2, 0.34], sky: [0.14, 0.11, 0.24], fog: [0.22, 0.18, 0.3], glow: 0.8 },        // civil: blue hour
  { elev: -2, ambient: [0.46, 0.33, 0.4], sky: [0.5, 0.27, 0.32], fog: [0.48, 0.32, 0.36], glow: 0.55 },       // pink/orange horizon
  { elev: 0, ambient: [0.66, 0.42, 0.36], sky: [0.74, 0.4, 0.3], fog: [0.66, 0.44, 0.36], glow: 0.42 },        // sunrise / sunset
  { elev: 6, ambient: [0.94, 0.7, 0.5], sky: [0.62, 0.55, 0.55], fog: [0.75, 0.62, 0.52], glow: 0.18 },        // golden hour
  { elev: 15, ambient: [1.0, 0.9, 0.78], sky: [0.42, 0.58, 0.76], fog: [0.66, 0.7, 0.74], glow: 0.05 },
  { elev: 30, ambient: [1.02, 0.99, 0.95], sky: [0.35, 0.55, 0.78], fog: [0.62, 0.68, 0.74], glow: 0 },        // neutral day
  { elev: 90, ambient: [1.03, 1.01, 0.98], sky: [0.33, 0.54, 0.8], fog: [0.6, 0.67, 0.74], glow: 0 },
];
/** Hue bias around the horizon: mornings a touch pinker, evenings a touch more orange (multiplied, |elev| < 10). */
export const DAWN_TINT: [number, number, number] = [1.0, 0.93, 1.06];
export const DUSK_TINT: [number, number, number] = [1.05, 0.97, 0.88];
/** Cool moonlight (added to ambient at night, scaled by moon illumination and how dark it is). */
export const MOON_TINT: [number, number, number] = [0.05, 0.07, 0.12];
export const LUNAR_DAYS = 29.53;

const ss = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const lerp3 = (a: readonly number[], b: readonly number[], s: number, o: [number, number, number]): [number, number, number] => { o[0] = a[0]! + (b[0]! - a[0]!) * s; o[1] = a[1]! + (b[1]! - a[1]!) * s; o[2] = a[2]! + (b[2]! - a[2]!) * s; return o; };

/** Sun elevation (deg) at `hours`: continuous, zero at 06:00 and 18:00. */
export function sunElevation(hours: number): number { return SUN_MAX_ELEV * Math.sin(((hours - 6) / 24) * 2 * Math.PI); }
export function dayPhase(elev: number): DayPhase { return elev < -18 ? "night" : elev < -12 ? "astronomical" : elev < -6 ? "nautical" : elev < 0 ? "civil" : elev < 6 ? "golden" : "day"; }
/** Moon illumination (0 new .. 1 full) for a day number (synodic month). */
export function moonIllumination(day: number): number { const p = (((day / LUNAR_DAYS) % 1) + 1) % 1; return 0.5 - 0.5 * Math.cos(p * 2 * Math.PI); }

/** Sample a curve table at `elev` (smoothstep between rows). Exposed for tests / tools. */
export function sampleDayCurve(elev: number, curve: readonly DayCurveKey[] = DAY_CURVE,
  out: { ambient: [number, number, number]; sky: [number, number, number]; fog: [number, number, number]; glow: number } = { ambient: [0, 0, 0], sky: [0, 0, 0], fog: [0, 0, 0], glow: 0 }): { ambient: [number, number, number]; sky: [number, number, number]; fog: [number, number, number]; glow: number } {
  let i = 1; while (i < curve.length - 1 && elev > curve[i]!.elev) i++;
  const a = curve[i - 1]!, b = curve[i]!; const s = ss((elev - a.elev) / Math.max(1e-6, b.elev - a.elev));
  lerp3(a.ambient, b.ambient, s, out.ambient); lerp3(a.sky, b.sky, s, out.sky); lerp3(a.fog, b.fog, s, out.fog); out.glow = a.glow + (b.glow - a.glow) * s; return out;
}
/** A reusable DayLighting for the per-frame `out` arguments (no allocation per frame). */
export function newDayLighting(): DayLighting {
  return { hours: 0, ambient: [0, 0, 0], sky: [0, 0, 0], fog: [0, 0, 0], daylight: 0, shadowDir: [0, 0], shadowAlpha: 0, haze: 0, sunElevation: 0, phase: "day", glow: 0, moon: { illumination: 0, light: 0 } };
}

/** `day` (optional) selects the moon phase (advanced continuously by `t`, no step at midnight); omitted = a half moon.
 *  `out` (optional) is filled and returned instead of a new object (per-frame callers). */
export function computeDayLighting(t: number, day?: number, out: DayLighting = newDayLighting()): DayLighting {
  const frac = ((t % 1) + 1) % 1; const hours = frac * 24;
  const elev = sunElevation(hours);
  const c = sampleDayCurve(elev, DAY_CURVE, out);
  // dawn vs dusk hue, fading out away from the horizon
  const near = 1 - ss(Math.abs(elev) / 10); const tint = hours < 12 ? DAWN_TINT : DUSK_TINT;
  for (let k = 0; k < 3; k++) { const m = 1 + (tint[k]! - 1) * near; c.ambient[k]! *= m; c.sky[k]! *= m; c.fog[k]! *= m; }
  const illum = day === undefined ? 0.5 : moonIllumination(day + frac);
  const dark = 1 - ss((elev + 12) / 12); // moon matters from nautical twilight down
  const moonLight = illum * dark;
  for (let k = 0; k < 3; k++) c.ambient[k]! += MOON_TINT[k]! * moonLight;
  const daylight = ss((elev + 4) / 28); // 0 below -4 deg .. 1 at 24 deg
  // Shadows: the sun's azimuth swings east -> west; length ~ 1/tan(elev), clamped. At night a faint moon shadow.
  const sunUp = elev > 0;
  const arc = sunUp ? (hours - 6) / 12 : (((hours + 6) % 24) / 12); // moon arc at night
  const az = arc * Math.PI; const e = Math.max(4, sunUp ? elev : Math.abs(elev)) * Math.PI / 180;
  const len = Math.min(1.8, 0.3 + 0.32 / Math.tan(e));
  out.shadowDir[0] = -Math.cos(az) * len * 0.9; out.shadowDir[1] = 0.18 + Math.sin(az) * 0.12 * len;
  const sunShadow = ss(elev / 10); const moonShadow = 0.12 * moonLight;
  const shadowAlpha = 0.42 * Math.max(sunShadow * (0.55 + 0.45 * ss(elev / 20)), moonShadow);
  const haze = Math.max(0, 1 - Math.abs(elev - 1) / 9);
  out.hours = hours; out.daylight = daylight; out.shadowAlpha = shadowAlpha; out.haze = haze; out.sunElevation = elev; out.phase = dayPhase(elev);
  out.moon.illumination = illum; out.moon.light = moonLight; return out;
}

/** Weather dimming of a lighting result (overcast/rain/fog/storm/snow 0..1), applied identically by both renderers. */
export function dimForWeather(day: DayLighting, w: { overcast: number; storm: number }, inPlace = false): DayLighting {
  return dimWeatherInto(day, w.overcast, w.storm, inPlace ? day : { ...day, ambient: [0, 0, 0], sky: [0, 0, 0], fog: [0, 0, 0], shadowDir: [day.shadowDir[0], day.shadowDir[1]], moon: { ...day.moon } });
}
const dimRgb = (c: [number, number, number], o: [number, number, number], d: number, grey: number): void => { const l = (c[0] + c[1] + c[2]) / 3; const r = (c[0] + (l - c[0]) * grey) * d, g = (c[1] + (l - c[1]) * grey) * d, b = (c[2] + (l - c[2]) * grey) * d * 1.02; o[0] = r; o[1] = g; o[2] = b; };
/** dimForWeather writing into `out` (may be `day` itself): allocation-free for the per-frame path. */
export function dimWeatherInto(day: DayLighting, overcast: number, storm: number, out: DayLighting): DayLighting {
  const d = 1 - 0.28 * overcast - 0.22 * storm; const grey = 0.35 * Math.max(overcast, storm);
  dimRgb(day.ambient, out.ambient, d, grey); dimRgb(day.sky, out.sky, d, grey); dimRgb(day.fog, out.fog, d, grey);
  out.shadowAlpha = day.shadowAlpha * (1 - 0.6 * overcast); out.glow = Math.min(1, day.glow + 0.25 * Math.max(overcast, storm) * day.daylight); return out;
}
