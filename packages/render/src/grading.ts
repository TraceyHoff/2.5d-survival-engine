/**
 * Time-of-day grading: keyframes {hour, sun, ambient, fog, shadowTint, lut?} blended by hour (CPU, a few floats)
 * and up to two LUT strips blended on the GPU in the composite pass.
 * LUT strip layout: N slices of NxN laid out horizontally (R = x within a slice, G = y, B = slice index).
 * Size is auto-detected from the image: N = height, slices = width / height (16³ = 256x16, 32³ = 1024x32).
 */
export type RGB = [number, number, number];
export interface GradingKeyframe { hour: number; sun: RGB; ambient: RGB; fog: RGB; shadowTint: RGB; lut?: string }
export interface GradingSample { a: number; b: number; t: number; sun: RGB; ambient: RGB; fog: RGB; shadowTint: RGB }

export function lutSizeFromImage(w: number, h: number): number | null {
  if (h < 2 || w !== h * h) return null;
  return h;
}

const rgb = (v: unknown): RGB | null => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;
const hex = (v: unknown): RGB | null => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255] : null;
const color = (v: unknown): RGB | null => rgb(v) ?? hex(v);

/** Accepts `[...]` or `{keyframes:[...]}`; colours as [r,g,b] (0..1, may exceed 1) or "#rrggbb". Sorted by hour. */
export function parseGradingKeyframes(json: unknown): { keyframes: GradingKeyframe[]; issues: string[] } {
  const issues: string[] = [];
  const list = Array.isArray(json) ? json : (json && typeof json === "object" && Array.isArray((json as { keyframes?: unknown }).keyframes)) ? (json as { keyframes: unknown[] }).keyframes : null;
  if (!list) return { keyframes: [], issues: ["keyframes: expected an array or {keyframes:[...]}"] };
  const out: GradingKeyframe[] = [];
  list.forEach((k, i) => {
    const o = (k ?? {}) as Record<string, unknown>;
    const hour = o.hour; if (typeof hour !== "number" || hour < 0 || hour >= 24) { issues.push(`[${i}] bad hour`); return; }
    const sun = color(o.sun), ambient = color(o.ambient), fog = color(o.fog), shadowTint = color(o.shadowTint ?? o.shadow_tint ?? o.shadow);
    if (!sun || !ambient || !fog || !shadowTint) { issues.push(`[${i}] missing/invalid sun|ambient|fog|shadowTint`); return; }
    for (const key of Object.keys(o)) if (!["hour", "sun", "ambient", "fog", "shadowTint", "shadow_tint", "shadow", "lut"].includes(key) && !key.startsWith("_")) issues.push(`[${i}] unknown key ${key}`);
    out.push({ hour, sun, ambient, fog, shadowTint, ...(typeof o.lut === "string" ? { lut: o.lut } : {}) });
  });
  out.sort((a, b) => a.hour - b.hour);
  return { keyframes: out, issues };
}

/** Blend the two keyframes around `hour` (wraps over midnight). a/b are keyframe indices, t the blend factor. */
export function sampleKeyframes(kf: readonly GradingKeyframe[], hour: number): GradingSample | null {
  if (kf.length === 0) return null;
  const h = ((hour % 24) + 24) % 24;
  let b = kf.findIndex((k) => k.hour > h); if (b < 0) b = 0;
  const a = (b - 1 + kf.length) % kf.length;
  const ha = kf[a]!.hour, hb = kf[b]!.hour;
  const span = ((hb - ha + 24) % 24) || 24; const t = (((h - ha + 24) % 24) / span);
  const mix = (x: RGB, y: RGB): RGB => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  const A = kf[a]!, B = kf[b]!;
  return { a, b, t, sun: mix(A.sun, B.sun), ambient: mix(A.ambient, B.ambient), fog: mix(A.fog, B.fog), shadowTint: mix(A.shadowTint, B.shadowTint) };
}

/** GLSL: sample a LUT strip (size N) with manual blue-slice interpolation. */
export const GLSL_LUT = /* glsl */ `
vec3 lutSample(sampler2D lut, vec3 c, float n) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * (n - 1.0); float s0 = floor(b), s1 = min(n - 1.0, s0 + 1.0);
  vec2 inSlice = vec2(c.r * (n - 1.0) + 0.5, c.g * (n - 1.0) + 0.5);
  vec2 sz = vec2(n * n, n);
  vec3 a = texture(lut, vec2(s0 * n + inSlice.x, inSlice.y) / sz).rgb;
  vec3 d = texture(lut, vec2(s1 * n + inSlice.x, inSlice.y) / sz).rgb;
  return mix(a, d, b - s0);
}`;

/** Identity LUT strip pixels (RGBA8) for size n, useful as a fallback and in tests. */
export function identityLut(n: number): Uint8Array {
  const w = n * n, px = new Uint8Array(w * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < w; x++) {
    const s = Math.floor(x / n), r = x % n; const o = (y * w + x) * 4;
    px[o] = Math.round((r / (n - 1)) * 255); px[o + 1] = Math.round((y / (n - 1)) * 255); px[o + 2] = Math.round((s / (n - 1)) * 255); px[o + 3] = 255;
  }
  return px;
}
