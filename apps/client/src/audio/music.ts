/**
 * ADR-117 adaptive music: a menu theme plus in-game explore / night / combat.low / combat.high layers that crossfade
 * with intensity. Exploration music is not wall-to-wall: after a play window it fades into a silence gap. Combat
 * overrides the gap. Pure state machine (layer gains) + a thin driver that keeps streamed voices in sync.
 */
import { LoopSet, type LoopPlayer } from "./loops.js";
export type MusicMode = "off" | "menu" | "game";
export interface MusicInput { mode: MusicMode; night: boolean; /** 0..1 threat: hostile count/proximity + combat tag. */ threat: number; dt: number }
export const LAYERS = ["music.menu", "music.explore", "music.night", "music.combat.low", "music.combat.high"] as const;
export type Layer = (typeof LAYERS)[number];

export class MusicDirector {
  gains: Record<Layer, number> = { "music.menu": 0, "music.explore": 0, "music.night": 0, "music.combat.low": 0, "music.combat.high": 0 };
  /** Seconds left in the current phase; phase "play" or "gap". */
  phase: "play" | "gap" = "play"; phaseLeft: number; private threatS = 0;
  constructor(private rng: () => number = Math.random, public playSec: [number, number] = [120, 180], public gapSec: [number, number] = [30, 90], public fadeSec = 3) { this.phaseLeft = this.pick(playSec); }
  private pick(r: [number, number]): number { return r[0] + this.rng() * (r[1] - r[0]); }
  targets(i: MusicInput): Record<Layer, number> {
    const t: Record<Layer, number> = { "music.menu": 0, "music.explore": 0, "music.night": 0, "music.combat.low": 0, "music.combat.high": 0 };
    if (i.mode === "menu") { t["music.menu"] = 1; return t; }
    if (i.mode !== "game") return t;
    const th = this.threatS;
    if (th > 0.15) { t["music.combat.low"] = Math.min(1, th * 2); t["music.combat.high"] = Math.max(0, (th - 0.5) * 2); return t; }
    if (this.phase === "gap") return t;
    t[i.night ? "music.night" : "music.explore"] = 1; return t;
  }
  step(i: MusicInput): Record<Layer, number> {
    // threat smoothing: fast attack, slow release (combat lingers ~6 s)
    this.threatS += (i.threat - this.threatS) * Math.min(1, i.dt * (i.threat > this.threatS ? 2 : 0.18));
    if (i.mode === "game" && this.threatS <= 0.15) { this.phaseLeft -= i.dt; if (this.phaseLeft <= 0) { this.phase = this.phase === "play" ? "gap" : "play"; this.phaseLeft = this.pick(this.phase === "play" ? this.playSec : this.gapSec); } }
    if (i.mode === "menu") { this.phase = "play"; this.phaseLeft = this.pick(this.playSec); }
    const tg = this.targets(i); const k = Math.min(1, i.dt / this.fadeSec);
    for (const l of LAYERS) { const d = tg[l] - this.gains[l]; this.gains[l] = Math.abs(d) <= k ? tg[l] : this.gains[l] + Math.sign(d) * k; }
    return this.gains;
  }
  get threat(): number { return this.threatS; }
}
/** Drives a MusicDirector against the mixer: a layer voice exists only while its gain > 0. */
export class MusicDriver {
  readonly dir: MusicDirector; private loops: LoopSet;
  constructor(p: LoopPlayer, rng?: () => number) { this.dir = new MusicDirector(rng); this.loops = new LoopSet(p, 1.5); }
  step(i: MusicInput): void { const g = this.dir.step(i); this.loops.sync(LAYERS.filter((l) => g[l] > 0.001).map((l) => ({ id: l, key: l, gain: g[l] }))); }
  clear(): void { this.loops.clear(); }
}
