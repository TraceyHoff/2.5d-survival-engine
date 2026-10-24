/**
 * ADR-118: real boot progress. Weighted stages (renderer/shader init, art manifest, atlases, building variants,
 * lighting/shader warm-up, menu ready) feed one monotonic target in [0,1]; EasedBar eases the displayed fill toward it
 * every frame and never moves backwards. Pure (no DOM) so it is unit-tested in node.
 */
export interface Stage { id: string; weight: number; label: string }
export const BOOT_STAGES: readonly Stage[] = [
  { id: "renderer", weight: 0.08, label: "Starting renderer" },
  { id: "manifest", weight: 0.1, label: "Loading art manifest" },
  { id: "atlases", weight: 0.52, label: "Loading sprite atlases" },
  { id: "variants", weight: 0.1, label: "Loading building variants" },
  { id: "lighting", weight: 0.15, label: "Compiling lighting shaders" },
  { id: "ready", weight: 0.05, label: "Getting ready" },
];

export class LoadProgress {
  private readonly frac = new Map<string, number>();
  private readonly total: number;
  private peak = 0;
  label: string;
  error: string | undefined;
  constructor(readonly stages: readonly Stage[] = BOOT_STAGES) {
    this.total = stages.reduce((s, x) => s + Math.max(0, x.weight), 0) || 1;
    this.label = stages[0]?.label ?? "Loading";
  }
  /** Report progress within a stage (0..1). Earlier stages count as complete; values never decrease. */
  update(id: string, f: number, label?: string): number {
    const i = this.stages.findIndex((s) => s.id === id); if (i < 0) return this.value;
    for (let k = 0; k < i; k++) this.frac.set(this.stages[k]!.id, 1);
    const v = Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0;
    this.frac.set(id, Math.max(this.frac.get(id) ?? 0, v));
    this.label = label ?? this.stages[i]!.label;
    return this.value;
  }
  begin(id: string, label?: string): number { return this.update(id, 0, label); }
  complete(): number { for (const s of this.stages) this.frac.set(s.id, 1); this.label = "Ready"; return this.value; }
  fail(message: string): void { this.error = message; }
  /** Monotonic weighted sum. */
  get value(): number {
    let s = 0; for (const st of this.stages) s += Math.max(0, st.weight) * (this.frac.get(st.id) ?? 0);
    this.peak = Math.max(this.peak, Math.min(1, s / this.total)); return this.peak;
  }
}

/** Counting progress with an unknown tail: done/expected, capped below 1 until the caller completes the stage. */
export function countFraction(done: number, expected: number, cap = 0.97): number {
  if (expected <= 0) return done > 0 ? cap : 0;
  return Math.max(0, Math.min(cap, done / expected));
}

/** Smoothly eased, monotonic display value chasing a target. Reduced motion snaps to the target. */
export class EasedBar {
  shown = 0; private target = 0;
  constructor(public reducedMotion = false, private readonly rate = 6) {}
  set(t: number): void { if (Number.isFinite(t)) this.target = Math.max(this.target, Math.max(0, Math.min(1, t))); }
  get goal(): number { return this.target; }
  /** Advance by dt seconds; returns the shown value. Exponential ease plus a small minimum speed so it lands on 1. */
  step(dt: number): number {
    const d = this.target - this.shown; if (d <= 0) return this.shown;
    if (this.reducedMotion) { this.shown = this.target; return this.shown; }
    const k = 1 - Math.exp(-this.rate * Math.max(0, Math.min(0.25, dt)));
    this.shown = Math.min(this.target, this.shown + Math.max(d * k, 0.15 * dt));
    if (this.target - this.shown < 0.0005) this.shown = this.target;
    return this.shown;
  }
  get done(): boolean { return this.shown >= 1; }
}

/** Zombie walker pose for the fill edge: 6-frame sheet index + vertical bob (px). Idle/reduced motion = frame 0, no bob. */
export function zombiePose(timeSec: number, moving: boolean, reducedMotion: boolean): { frame: number; bob: number } {
  if (reducedMotion || !moving) return { frame: 0, bob: 0 };
  const frame = Math.floor((timeSec / 0.857) * 6) % 6;
  return { frame, bob: -Math.abs(Math.sin(timeSec * Math.PI * 2 / 0.4286)) * 3 };
}
