/**
 * Runtime GPU-memory fallback ladder + blank-frame watchdog (pure, unit-tested; IsoRenderer drives the GL side).
 *
 * Mobile drivers (Mali/Adreno/PowerVR) report OUT_OF_MEMORY or leave textures / render targets unallocated *after*
 * start-up, e.g. once a singleplayer world streams many dressed characters. A one-shot start-up check cannot catch
 * that, so every atlas / wearable-page allocation and FBO resize reports a fault here and the renderer steps down:
 *
 *   0 full -> 1 evict wearables (body-only) -> 2 cap dressed characters (nearest N) -> 3 cold / lower atlas tier
 *          -> 4 safe mode (no bloom / LUT, RGBA8 + DEPTH16 targets)
 *
 * Each fault moves at most one step per `cooldownFrames` so one bad frame cannot jump straight to safe mode.
 */
import type { Rgba } from "./diag.js";

export const enum FallbackStep { Full = 0, EvictWearables = 1, CapDressed = 2, LowTier = 3, Safe = 4 }
export const FALLBACK_STEP_NAMES = ["full", "evict-wearables", "cap-dressed", "low-tier", "safe"] as const;
export const MAX_FALLBACK_STEP = FallbackStep.Safe;

export interface FallbackFault { frame: number; source: string; detail: string; step: number }

export class FallbackLadder {
  step: number = FallbackStep.Full;
  readonly faults: FallbackFault[] = [];
  private lastEscalation = -Infinity;
  /** faults seen while already at the bottom step or inside the cooldown */
  suppressed = 0;
  constructor(readonly cooldownFrames = 30, readonly maxLog = 12) {}
  get name(): string { return FALLBACK_STEP_NAMES[this.step]!; }
  get exhausted(): boolean { return this.step >= MAX_FALLBACK_STEP; }
  /** Record a fault; returns the new step when the ladder moved (caller applies it), else null. */
  fault(source: string, detail: string, frame: number): number | null {
    if (this.exhausted || frame - this.lastEscalation < this.cooldownFrames) { this.suppressed++; this.log(source, detail, frame); return null; }
    this.step++; this.lastEscalation = frame; this.log(source, detail, frame); return this.step;
  }
  /** Force a minimum step (e.g. `?gl=safe` at start). */
  atLeast(step: number): void { this.step = Math.max(this.step, Math.min(MAX_FALLBACK_STEP, step)); }
  private log(source: string, detail: string, frame: number): void { this.faults.push({ frame, source, detail, step: this.step }); if (this.faults.length > this.maxLog) this.faults.shift(); }
  report(): string[] {
    const L = [`fallback: step ${this.step} (${this.name})${this.suppressed ? `, ${this.suppressed} faults suppressed` : ""}`];
    for (const f of this.faults) L.push(`  f${f.frame} ${f.source}: ${f.detail} -> ${FALLBACK_STEP_NAMES[f.step]}`);
    return L;
  }
}

/** True when every sample equals the first one (within tol): a flat frame (clear colour, brown fog over an empty scene, black). */
export function isFlatFrame(px: readonly Rgba[], tol = 2): boolean {
  if (px.length < 2) return false; const a = px[0]!;
  return px.every((p) => Math.abs(p[0] - a[0]) <= tol && Math.abs(p[1] - a[1]) <= tol && Math.abs(p[2] - a[2]) <= tol);
}

/**
 * Ongoing blank-frame watchdog: every `interval` frames the renderer reads a few centre pixels of the scene FBO and
 * the final output; `consecutive` flat samples while instances were drawn -> blank. Runs for the whole session (the
 * start-up probe only covers frames 1 and 60, the client's black check the first 90 frames).
 */
export class BlankWatchdog {
  checks = 0; blanks = 0; streak = 0; lastFrame = 0; last: Rgba[] = []; trips = 0;
  constructor(readonly interval = 60, readonly consecutive = 2, readonly startFrame = 90) {}
  due(frame: number): boolean { return frame >= this.startFrame && (frame - this.startFrame) % this.interval === 0; }
  /** Feed one sample; returns true when the watchdog trips (streak reached; streak resets so a trip is not repeated every check). */
  sample(frame: number, scene: readonly Rgba[], output: readonly Rgba[], instances: number): boolean {
    this.checks++; this.lastFrame = frame; this.last = [...output];
    const blank = instances > 0 && isFlatFrame(output) && isFlatFrame(scene);
    if (!blank) { this.streak = 0; return false; }
    this.blanks++; this.streak++;
    if (this.streak >= this.consecutive) { this.streak = 0; this.trips++; return true; }
    return false;
  }
  report(): string {
    const hex = (p: Rgba) => "#" + p.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
    return `watchdog: every ${this.interval}f, ${this.checks} checks, ${this.blanks} blank, ${this.trips} trips${this.last.length ? `, last f${this.lastFrame} ${this.last.map(hex).join(" ")}` : ""}`;
  }
}

/** Nearest-N cutoff: the squared distance of the n-th nearest candidate (Infinity when fewer than n+1). */
export function nearestCutoff(d2: Float32Array, count: number, n: number): number {
  if (!Number.isFinite(n) || count <= n) return Infinity; if (n <= 0) return -1;
  const a = d2.slice(0, count).sort(); return a[n - 1]!;
}
