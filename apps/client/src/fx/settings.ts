/**
 * ADR-214 VFX settings (persisted, live): effect density, screen shake, hit-stop, reduce-motion and ambient particles.
 * Defaults are the full look on every device; the device budget (quality tier) scales particle counts, never the default.
 */
export type FxLevel = "full" | "reduced" | "off";
export type FxMotion = "auto" | "on" | "off";
export interface FxSettings {
  /** Particle effects density: full (default), reduced (half budget), off (no layer at all). */
  effects: FxLevel;
  /** Subtle camera shake on heavy hits, explosions, tree falls. */
  shake: boolean;
  /** Brief time dilation of effects (never the sim or input) on heavy hits. */
  hitStop: boolean;
  /** "auto" follows the OS prefers-reduced-motion; "on" forces calm (no shake / hit-stop / light flicker). */
  reduceMotion: FxMotion;
  /** Ambient life: fireflies, dust motes, god rays, wind leaves, rain splashes. */
  ambient: boolean;
  /** Damage vignette + low-health pulse. */
  vignette: boolean;
}
export const FX_SETTINGS_KEY = "survivaz.fx.v1";
export const DEFAULT_FX: Readonly<FxSettings> = Object.freeze({ effects: "full", shake: true, hitStop: true, reduceMotion: "auto", ambient: true, vignette: true });

const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (typeof v === "string" && (ok as readonly string[]).includes(v) ? (v as T) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
export function normalizeFx(raw: unknown): FxSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { effects: pick(o["effects"], ["full", "reduced", "off"] as const, DEFAULT_FX.effects), shake: bool(o["shake"], DEFAULT_FX.shake), hitStop: bool(o["hitStop"], DEFAULT_FX.hitStop),
    reduceMotion: pick(o["reduceMotion"], ["auto", "on", "off"] as const, DEFAULT_FX.reduceMotion), ambient: bool(o["ambient"], DEFAULT_FX.ambient), vignette: bool(o["vignette"], DEFAULT_FX.vignette) };
}
type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
export function loadFx(s: Store | undefined = store()): FxSettings {
  try { const t = s?.getItem(FX_SETTINGS_KEY); return normalizeFx(t ? JSON.parse(t) : undefined); } catch { return normalizeFx(undefined); }
}
export function saveFx(v: FxSettings, s: Store | undefined = store()): void { try { s?.setItem(FX_SETTINGS_KEY, JSON.stringify(normalizeFx(v))); } catch { /* private mode */ } }

/** What the layer actually does this frame. */
export interface FxResolved { on: boolean; density: number; shake: number; hitStop: boolean; flicker: boolean; ambient: boolean; vignette: boolean; calm: boolean }
export function resolveFx(s: FxSettings, prefersReducedMotion: boolean): FxResolved {
  const calm = s.reduceMotion === "on" || (s.reduceMotion === "auto" && prefersReducedMotion);
  const on = s.effects !== "off";
  return { on, density: s.effects === "full" ? 1 : s.effects === "reduced" ? 0.5 : 0, shake: on && s.shake && !calm ? 1 : 0, hitStop: on && s.hitStop && !calm,
    flicker: on && !calm, ambient: on && s.ambient, vignette: on && s.vignette, calm };
}
/** Particle budget for a device: base x quality-tier particle multiplier x density, capped at the pool capacity. */
export function particleBudget(base: number, tierParticles: number, density: number, capacity: number): number {
  return Math.max(0, Math.min(capacity, Math.round(base * Math.max(0.25, tierParticles) * density)));
}
