/**
 * Renderer-side look knobs. Defaults are NEUTRAL (no outline, no banding, no grading) — the art
 * direction is owned by Art & Assets, who tune these per theme via `renderer.setStyle({...})`.
 */
export interface StyleConfig {
  /** Shader sprite outline (drawn outside the alpha silhouette). */
  outline: { enabled: boolean; widthPx: number; color: [number, number, number, number] };
  /** Light quantisation: 0 = smooth, N = N bands; `bandMix` blends smooth<->banded (0..1). */
  lightBands: number; bandMix: number;
  /** Floor for the ambient term (0..1 luminance) and the tint used to reach it at night. */
  nightMinBrightness: number; nightTint: [number, number, number];
  /** Colour grading applied in composite. */
  grading: { saturation: number; contrast: number; lift: [number, number, number]; gain: [number, number, number] };
  fogColor: [number, number, number];
  /** "blob" = soft ellipse under each Shadow entity; "projected" = sun-skewed silhouette; "none". */
  shadowMode: "blob" | "projected" | "none";
  blobShadow: { alpha: number; widthFactor: number; aspect: number };
  /** Multiplier for emissive masks / Emissive sprites (how strongly they ignore darkness). */
  emissiveStrength: number;
  /** Point-light contribution scale during full daylight (0..1). */
  daylightLightScale: number;
  /** Building level height in screen px (one floor). */
  levelHeightPx: number;
  /** Alpha for cut-away roofs / upper floors when the focus entity is inside. */
  cutawayAlpha: number;
  /** Bloom from emissive-masked / Emissive-flagged pixels only (fire, windows, eyes); never a global threshold. */
  bloom: { strength: number; radiusPx: number; nightBoost: number };
  /** Grading LUT strip (16³ 256x16 or 32³ 1024x32, auto-detected) and time-of-day keyframes; URLs resolve relative to the tuning file. */
  gradingLut: { url: string | null; strength: number; keyframes: string | null };
  /** Shadow colour (multiplied by alpha); keyframes may override per hour. */
  shadowTint: [number, number, number];
  /** Per-sprite survival FX. */
  fx: { wetDarken: number; wetSheen: number; frostColor: [number, number, number]; flushTint: [number, number, number]; flushStrength: number };
  /** Ground overlays (procedural fallback). wetRate/dryRate: surface wetness per second under full rain / when dry. */
  surface: { wetDarken: number; puddles: number; skyReflection: [number, number, number]; wetRate: number; dryRate: number; snowRate: number; meltRate: number };
  /** Wind for sway when Weather.windSpeed is 0. dir in radians (tile axes), speed in tiles/s; refSpeed maps speed to sway strength 1. */
  wind: { defaultDir: number; defaultSpeed: number; refSpeed: number };
  /** Cloud shadows: tileable noise scrolled by wind (alpha 0 disables). */
  clouds: { alpha: number; scalePx: number; overcastBoost: number };
  /** Storm lightning: screen flash + optional bolt sprite (`fx_lightning` in the registry). */
  lightning: { enabled: boolean; flash: number; meanIntervalSec: number; color: [number, number, number] };
  /** Heat shimmer around heat Emitters (strength 0 disables). */
  shimmer: { strength: number; scale: number; speed: number };
}

export const DEFAULT_STYLE: StyleConfig = {
  outline: { enabled: false, widthPx: 1, color: [0.1, 0.08, 0.12, 1] },
  lightBands: 0, bandMix: 0,
  nightMinBrightness: 0, nightTint: [0.55, 0.55, 0.8],
  grading: { saturation: 1, contrast: 1, lift: [0, 0, 0], gain: [1, 1, 1] },
  fogColor: [0.72, 0.76, 0.8],
  shadowMode: "blob",
  blobShadow: { alpha: 0.35, widthFactor: 0.55, aspect: 0.4 },
  emissiveStrength: 1,
  daylightLightScale: 0.2,
  levelHeightPx: 48,
  cutawayAlpha: 0.18,
  bloom: { strength: 0.35, radiusPx: 6, nightBoost: 1 },
  gradingLut: { url: null, strength: 1, keyframes: null },
  shadowTint: [0, 0, 0],
  fx: { wetDarken: 0.72, wetSheen: 0.35, frostColor: [0.82, 0.9, 1], flushTint: [1.15, 0.82, 0.78], flushStrength: 0.5 },
  surface: { wetDarken: 0.75, puddles: 1, skyReflection: [0.55, 0.62, 0.72], wetRate: 0.05, dryRate: 0.008, snowRate: 0.02, meltRate: 0.01 },
  wind: { defaultDir: 0.6, defaultSpeed: 2, refSpeed: 10 },
  clouds: { alpha: 0, scalePx: 900, overcastBoost: 0.5 },
  lightning: { enabled: true, flash: 0.7, meanIntervalSec: 7, color: [0.8, 0.85, 1] },
  shimmer: { strength: 1, scale: 1, speed: 1 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type StylePatch = DeepPartial<StyleConfig>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; out[k] = isObj(out[k]) && isObj(v) ? deepMerge(out[k] as Record<string, unknown>, v) : v; }
  return out;
}
export function mergeStyle(base: StyleConfig, patch: StylePatch): StyleConfig {
  return deepMerge(structuredClone(base) as unknown as Record<string, unknown>, patch as Record<string, unknown>) as unknown as StyleConfig;
}

/**
 * Validate a render_tuning.json (Art & Assets' look override layer) against the StyleConfig shape.
 * Unknown keys and type mismatches are dropped with a warning; the rest is merged over `base`.
 * Keys starting with "$" or "_" (comments/meta) are ignored silently.
 */
export function loadRenderTuning(json: unknown, base: StyleConfig = DEFAULT_STYLE): { style: StyleConfig; patch: StylePatch; warnings: string[] } {
  const warnings: string[] = [];
  const clean = (v: unknown, ref: unknown, path: string): unknown => {
    if (isObj(ref)) {
      if (!isObj(v)) { warnings.push(`${path}: expected object`); return undefined; }
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith("$") || k.startsWith("_")) continue;
        if (!(k in ref)) { warnings.push(`unknown key ${path ? path + "." : ""}${k}`); continue; }
        const c = clean(x, (ref as Record<string, unknown>)[k], path ? `${path}.${k}` : k); if (c !== undefined) out[k] = c;
      }
      return out;
    }
    if (Array.isArray(ref)) {
      if (!Array.isArray(v) || v.length !== ref.length || !v.every((n) => typeof n === "number" && Number.isFinite(n))) { warnings.push(`${path}: expected number[${ref.length}]`); return undefined; }
      return v;
    }
    if (ref === null) { if (v === null || typeof v === "string") return v; warnings.push(`${path}: expected string|null`); return undefined; }
    if (typeof ref === "string" && path === "shadowMode") { if (v === "blob" || v === "projected" || v === "none") return v; warnings.push(`${path}: expected blob|projected|none`); return undefined; }
    if (typeof v !== typeof ref) { warnings.push(`${path}: expected ${typeof ref}`); return undefined; }
    if (typeof v === "number" && !Number.isFinite(v)) { warnings.push(`${path}: not finite`); return undefined; }
    return v;
  };
  const patch = (clean(json, base, "") ?? {}) as StylePatch;
  return { style: mergeStyle(base, patch), patch, warnings };
}
