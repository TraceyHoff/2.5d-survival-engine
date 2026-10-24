/**
 * Adaptive quality: fixed tiers + a frame-time governor (target 60 fps, floor 30 fps, hysteresis) and the user-facing
 * Settings preset (Auto / Low / Medium / High, persisted). Auto runs the governor; fixed presets pin a tier.
 */
export interface QualityTier { name: string; resScale: number; lightDownscale: number; bloom: boolean; weather: number; particles: number }
export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: "low", resScale: 0.6, lightDownscale: 4, bloom: false, weather: 0.4, particles: 0.5 },
  { name: "medium", resScale: 0.75, lightDownscale: 4, bloom: false, weather: 0.6, particles: 0.75 },
  { name: "high", resScale: 0.85, lightDownscale: 2, bloom: true, weather: 0.85, particles: 1 },
  { name: "ultra", resScale: 1, lightDownscale: 2, bloom: true, weather: 1, particles: 1 },
];
export type QualityPreset = "auto" | "low" | "medium" | "high";
export const QUALITY_PRESETS: readonly QualityPreset[] = ["auto", "low", "medium", "high"];
const PRESET_TIER: Record<Exclude<QualityPreset, "auto">, number> = { low: 0, medium: 1, high: 3 };
export const PRESET_STORAGE_KEY = "survivaz.render.quality";

export interface GovernorOptions {
  /** frame ms considered "at target" (60 fps budget with a little slack) */ targetMs?: number;
  /** floor: above this the governor steps down quickly */ floorMs?: number;
  /** ms of sustained slow frames before a step down */ downAfterMs?: number;
  /** ms of sustained fast frames before a step up */ upAfterMs?: number;
  /** step up only when the EMA is below targetMs * upRatio (hysteresis band) */ upRatio?: number;
  /** ms after any change during which no further change happens */ cooldownMs?: number;
}

/** Frame-time governor. feed(dtMs) every frame; returns true when `level` changed. Allocation-free. */
export class QualityGovernor {
  level: number; ema = 16.7; changes = 0;
  private slow = 0; private fast = 0; private cool = 0;
  private readonly o: Required<GovernorOptions>;
  constructor(start = QUALITY_TIERS.length - 1, opts: GovernorOptions = {}) {
    this.level = start;
    this.o = { targetMs: 1000 / 60 * 1.1, floorMs: 1000 / 30, downAfterMs: 1500, upAfterMs: 5000, upRatio: 0.75, cooldownMs: 2500, ...opts };
  }
  get tier(): QualityTier { return QUALITY_TIERS[this.level]!; }
  feed(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > 1000) return false; // tab hidden / hitch: ignore
    this.ema += (dtMs - this.ema) * 0.08;
    if (this.cool > 0) { this.cool -= dtMs; return false; }
    const o = this.o;
    if (this.ema > o.targetMs) { this.slow += this.ema > o.floorMs ? dtMs * 2 : dtMs; this.fast = 0; }
    else if (this.ema < o.targetMs * o.upRatio) { this.fast += dtMs; this.slow = 0; }
    else { this.slow = Math.max(0, this.slow - dtMs); this.fast = Math.max(0, this.fast - dtMs); }
    if (this.slow >= o.downAfterMs && this.level > 0) return this.step(-1);
    if (this.fast >= o.upAfterMs && this.level < QUALITY_TIERS.length - 1) return this.step(1);
    return false;
  }
  private step(d: number): boolean { this.level += d; this.slow = this.fast = 0; this.cool = this.o.cooldownMs; this.changes++; return true; }
}

/** Preset + governor: `tier` is what the renderer applies. */
export class QualityController {
  readonly governor: QualityGovernor; preset: QualityPreset;
  constructor(preset: QualityPreset = "auto", startLevel?: number) { this.preset = preset; this.governor = new QualityGovernor(startLevel); }
  get level(): number { return this.preset === "auto" ? this.governor.level : PRESET_TIER[this.preset]; }
  get tier(): QualityTier { return QUALITY_TIERS[this.level]!; }
  get current(): QualityTier { return this.tier; }
  setPreset(p: QualityPreset): void { this.preset = p; savePreset(p); }
  /** returns true when the applied tier changed */
  feed(dtMs: number): boolean { const changed = this.governor.feed(dtMs); return changed && this.preset === "auto"; }
  describe(): string { const t = this.tier; return `quality: preset ${this.preset}${this.preset === "auto" ? ` (governor ema ${this.governor.ema.toFixed(1)}ms, ${this.governor.changes} changes)` : ""} -> ${t.name}: res x${t.resScale}, light 1/${t.lightDownscale}, bloom ${t.bloom ? "on" : "off"}, weather x${t.weather}, particles x${t.particles}`; }
}

export function parsePreset(v: string | null | undefined): QualityPreset | null { return v && (QUALITY_PRESETS as readonly string[]).includes(v) ? v as QualityPreset : null; }
export function loadPreset(): QualityPreset { try { return parsePreset(globalThis.localStorage?.getItem(PRESET_STORAGE_KEY)) ?? "auto"; } catch { return "auto"; } }
export function savePreset(p: QualityPreset): void { try { globalThis.localStorage?.setItem(PRESET_STORAGE_KEY, p); } catch { /* private mode */ } }
