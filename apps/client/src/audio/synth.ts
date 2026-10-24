/**
 * ADR-117 procedural placeholder SFX: tiny WebAudio-free synthesis into Float32Array (mono) so every bank key is
 * audible and testable before Art's real files land. Deterministic per (recipe, freq, variant). Unknown recipe -> a
 * short soft tick (never throws).
 */
import type { SynthSpec } from "./bank.js";

function mulberry(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const TAU = Math.PI * 2;
const NOTE = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Render a placeholder. `sr` = sample rate; loops are rendered loop-safe (fade-free, periodic noise beds). */
export function synthesize(spec: SynthSpec, sr: number, variant = 0): Float32Array {
  const len = Math.max(0.03, Math.min(spec.len || 0.3, 16));
  const n = Math.floor(len * sr); const out = new Float32Array(n);
  const rnd = mulberry(hash(`${spec.r}:${spec.f}:${variant}`)); const f0 = (spec.f || 440) * (1 + (rnd() - 0.5) * 0.1);
  let lp = 0, lp2 = 0, ph = 0, ph2 = 0;
  const env = (t: number, a: number, d: number): number => (t < a ? t / a : Math.exp(-(t - a) / d));
  const noise = (): number => rnd() * 2 - 1;
  const onePole = (x: number, hz: number): number => { const k = Math.min(1, (TAU * hz) / sr); lp += k * (x - lp); return lp; };
  const fill = (fn: (t: number, i: number) => number): void => { for (let i = 0; i < n; i++) out[i] = fn(i / sr, i); };
  switch (spec.r) {
    case "step": case "thud": case "dig": fill((t) => onePole(noise(), f0 * (spec.r === "dig" ? 3 : 2)) * env(t, 0.004, spec.r === "thud" ? 0.09 : 0.04) * 2.5 + Math.sin(TAU * f0 * 0.5 * t) * env(t, 0.002, 0.03) * 0.4); break;
    case "splash": fill((t) => { const x = noise(); lp2 += 0.3 * (x - lp2); return (x - lp2) * env(t, 0.02, len / 3) * 0.6; }); break;
    case "smack": case "crack": fill((t) => (noise() * env(t, 0.001, 0.02) + Math.sin(TAU * f0 * t * (1 - t)) * env(t, 0.002, 0.06)) * 0.8); break;
    case "clank": case "bell": fill((t) => [1, 2.76, 5.4].reduce((a, m, k) => a + Math.sin(TAU * f0 * m * t) * env(t, 0.001, (spec.r === "bell" ? 0.5 : 0.15) / (k + 1)), 0) * 0.35 + noise() * env(t, 0.001, 0.01) * 0.3); break;
    case "whoosh": fill((t) => { const p = Math.sin(Math.PI * t / len); return onePole(noise(), f0 * (0.5 + p)) * p * 2; }); break;
    case "rustle": case "crunch": fill((t) => noise() * (rnd() < 0.08 ? 1 : 0.25) * env(t, 0.01, len / 3) * 0.6); break;
    case "pop": case "click": case "tick": fill((t) => Math.sin(TAU * f0 * t * (spec.r === "pop" ? 1 + 4 * t : 1)) * env(t, 0.001, spec.r === "pop" ? 0.05 : 0.012) * 0.6); break;
    case "chime": fill((t) => (Math.sin(TAU * f0 * t) + 0.5 * Math.sin(TAU * f0 * 1.5 * t * (t > 0.12 ? 1 : 0))) * env(t, 0.005, 0.25) * 0.35); break;
    case "fanfare": fill((t) => { const step = Math.min(3, Math.floor(t / 0.18)); const f = f0 * [1, 1.25, 1.5, 2][step]!; return Math.sin(TAU * f * t) * env(t - step * 0.18, 0.01, step === 3 ? 0.8 : 0.15) * 0.35; }); break;
    case "boom": case "thunder": fill((t) => { const x = onePole(noise(), spec.r === "boom" ? 300 * Math.exp(-t * 2) + 40 : 200); return (x * 6 + Math.sin(TAU * f0 * t) * (spec.r === "boom" ? env(t, 0.005, 0.3) : 0)) * env(t, spec.r === "thunder" ? 0.15 : 0.003, len / 3); }); break;
    case "gunshot": fill((t) => (noise() * env(t, 0.0005, 0.03) + onePole(noise(), f0) * env(t, 0.002, 0.12) * 2) * 0.8); break;
    case "twang": fill((t) => (Math.sin(TAU * f0 * t) * Math.sin(TAU * 7 * t + 1) + noise() * env(t, 0.001, 0.01)) * env(t, 0.001, 0.12) * 0.6); break;
    case "reload": fill((t) => (t % 0.35 < 0.02 ? noise() : 0) * 0.7 + Math.sin(TAU * f0 * t) * (t % 0.35 < 0.02 ? 0.3 : 0)); break;
    case "creak": fill((t) => { ph += (f0 * (1 + 0.3 * Math.sin(TAU * 3 * t))) / sr; return ((ph % 1) - 0.5) * 0.3 * Math.sin(Math.PI * t / len); }); break;
    case "sizzle": case "crackle": case "ignite": fill((t) => { const pop = rnd() < (spec.r === "crackle" ? 0.0015 : 0.004) ? 1 : 0; lp2 = lp2 * 0.9 + pop; const hiss = onePole(noise(), 4000) * (spec.r === "crackle" ? 0.08 : 0.25);
      return (lp2 * noise() * 0.8 + (noise() - hiss) * 0.08) * (spec.r === "ignite" ? env(t, 0.05, 0.4) : 1); }); break;
    case "snuff": fill((t) => onePole(noise(), 400 + 1500 * Math.exp(-t * 4)) * Math.sin(Math.PI * Math.min(1, t / len)) * 2.5); break;
    case "groan": case "growl": case "grunt": case "moo": case "howl": case "bleat": case "quack": case "shiver": case "breath": {
      const rough = spec.r === "growl" ? 0.9 : spec.r === "groan" ? 0.4 : spec.r === "bleat" || spec.r === "quack" ? 0.6 : 0.2;
      const bend = spec.r === "howl" ? 0.5 : spec.r === "groan" ? -0.2 : 0;
      fill((t) => { const p = t / len; ph += (f0 * (1 + bend * Math.sin(Math.PI * p)) * (1 + 0.04 * Math.sin(TAU * (spec.r === "bleat" ? 18 : 6) * t))) / sr;
        const saw = (ph % 1) * 2 - 1; const v = onePole(saw + rough * noise(), f0 * 4); return v * Math.sin(Math.PI * p) * 0.6; }); break; }
    case "shriek": case "squeal": case "chirp": case "hoot": fill((t) => { const p = t / len; const f = spec.r === "hoot" ? f0 * (1 - 0.1 * p) : f0 * (1 + 0.5 * Math.sin(Math.PI * p));
      ph += f / sr; return Math.sin(TAU * ph) * (spec.r === "chirp" ? Math.max(0, Math.sin(TAU * 12 * t)) : 1) * Math.sin(Math.PI * p) * (spec.r === "shriek" ? 0.4 + 0.2 * noise() : 0.4); }); break;
    case "hiss": fill((t) => noise() * Math.sin(Math.PI * t / len) * 0.25); break;
    case "gulp": fill((t) => Math.sin(TAU * f0 * (1 + 2 * (t % 0.25)) * t) * env(t % 0.25, 0.01, 0.05) * 0.5); break;
    case "engine": case "engine_start": case "chain": case "rumble": fill((t) => { const f = spec.r === "engine_start" ? f0 * (0.3 + 0.7 * Math.min(1, t / (len * 0.6))) : f0; ph += f / sr; ph2 += (f * 2) / sr;
      const pulse = spec.r === "chain" ? (Math.sin(TAU * ph * 0.25) > 0.95 ? noise() : 0) * 0.5 : ((ph % 1) < 0.3 ? 1 : -0.4) * 0.3 + Math.sin(TAU * ph2) * 0.1;
      return onePole(pulse + noise() * 0.05, spec.r === "rumble" ? 120 : 900) * (spec.r === "engine_start" ? Math.sin(Math.PI * t / len) : 1) * 1.2; }); break;
    case "horn": fill((t) => ((Math.sin(TAU * f0 * t) > 0 ? 0.25 : -0.25) + (Math.sin(TAU * f0 * 1.26 * t) > 0 ? 0.2 : -0.2)) * Math.min(1, t / 0.02, (len - t) / 0.05)); break;
    case "rain": case "wind": case "water": { fill((t) => { const x = noise(); if (spec.r === "rain") return (x - onePole(x, 1500)) * 0.3 + (rnd() < 0.002 ? noise() * 0.4 : 0);
      if (spec.r === "wind") { const g = 0.5 + 0.5 * Math.sin(TAU * t / len * 2) * Math.sin(TAU * t / len * 3); return onePole(x, 200 + 500 * g) * (0.8 + g); }
      return onePole(x, 500) * (0.7 + 0.6 * Math.max(0, Math.sin(TAU * t / (len / 3)))) * 1.5; }); break; }
    case "birds": case "crickets": fill((t) => { if (spec.r === "crickets") { const on = Math.sin(TAU * 3.5 * t) > 0.3 ? 1 : 0; return Math.sin(TAU * 4200 * t) * on * Math.max(0, Math.sin(TAU * 40 * t)) * 0.06; }
      const s = (t * 1.7) % 1; const ok = Math.floor(t * 1.7) % 3 !== 1; return ok && s < 0.25 ? Math.sin(TAU * (2600 + 900 * Math.sin(TAU * 18 * s)) * t) * Math.sin(Math.PI * s / 0.25) * 0.08 : 0; }); break;
    default:
      if (spec.r.startsWith("music_")) return music(spec.r, len, sr, rnd);
      fill((t) => Math.sin(TAU * 1000 * t) * env(t, 0.001, 0.01) * 0.2);
  }
  // fade one-shot edges to avoid clicks (loops are periodic enough at these lengths)
  const fade = Math.min(n >> 2, Math.floor(sr * 0.004)); for (let i = 0; i < fade; i++) { out[n - 1 - i]! *= i / fade; }
  // normalize hot recipes (booms, gunshots) to a 0.9 peak so placeholders never clip the bus
  let peak = 0; for (let i = 0; i < n; i++) { const a = Math.abs(out[i]!); if (a > peak) peak = a; } if (peak > 0.9) { const k = 0.9 / peak; for (let i = 0; i < n; i++) out[i]! *= k; }
  return out;
}

/** Placeholder music: slow chord pad (calm/menu), low drone + heartbeat (night), pulse + drums (combat layers). */
function music(kind: string, len: number, sr: number, rnd: () => number): Float32Array {
  const n = Math.floor(len * sr); const out = new Float32Array(n);
  const prog: Record<string, number[][]> = { music_menu: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], music_calm: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
    music_night: [[45, 48, 52], [44, 48, 51]], music_combat_low: [[50, 53, 57], [48, 51, 55]], music_combat_high: [[50, 53, 57], [46, 50, 53]], music_death: [[45, 48, 51]] };
  const chords = prog[kind] ?? prog["music_calm"]!; const bar = len / chords.length;
  for (let i = 0; i < n; i++) {
    const t = i / sr; const c = chords[Math.min(chords.length - 1, Math.floor(t / bar))]!; const tb = t % bar;
    const swell = Math.min(1, tb / 0.8, (bar - tb) / 0.8);
    let v = 0; for (const m of c) v += Math.sin(TAU * NOTE(m) * t) * 0.08 + Math.sin(TAU * NOTE(m + 12) * t + 1) * 0.02;
    v *= swell;
    if (kind === "music_night") v = v * 0.6 + (t % 1.2 < 0.12 ? Math.sin(TAU * 55 * t) * Math.exp(-(t % 1.2) * 30) * 0.6 : 0);
    if (kind.startsWith("music_combat")) { const beat = t % 0.4; v += Math.sin(TAU * 50 * t) * Math.exp(-beat * 25) * 0.5; if (kind === "music_combat_high") v += (rnd() * 2 - 1) * Math.exp(-((t + 0.2) % 0.4) * 60) * 0.25; }
    if (kind === "music_death") v *= Math.exp(-t / 2);
    out[i] = v;
  }
  return out;
}
