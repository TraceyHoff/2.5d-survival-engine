/**
 * ADR-117 ambience: weather beds (rain / storm / wind / snow, indoor rain-on-roof variant), day/night biome beds
 * picked from the tiles around the listener, shoreline water, and sparse random one-shots (birds by day, owls and
 * distant zombie moans at night, thunder in storms). Pure: returns desired loops + one-shots.
 */
import type { LoopSpec, SoundEvent } from "./events.js";
export interface AmbienceInput { dayFrac: number; weather: number; intensity: number; windSpeed: number; indoors: boolean;
  /** Fractions 0..1 of nearby tiles: water, sand, forest (dirt/trees), stone. */ biome: { water: number; sand: number; forest: number; stone: number }; dt: number; inGame: boolean }
export const WEATHER = { Clear: 0, Rain: 1, Storm: 2, Snow: 3, Fog: 4 } as const;
/** 0 at night, 1 at day, smooth over dawn (0.2-0.3) and dusk (0.7-0.8); dayFrac 0 = midnight, 0.5 = noon. */
export function daylight(f: number): number { const x = ((f % 1) + 1) % 1; if (x < 0.2 || x > 0.8) return 0; if (x > 0.3 && x < 0.7) return 1; return x <= 0.3 ? (x - 0.2) / 0.1 : (0.8 - x) / 0.1; }
export function dayBedKey(b: AmbienceInput["biome"]): string { const m = Math.max(b.sand, b.forest, b.stone); if (m < 0.3) return "amb.day"; return m === b.forest ? "amb.day.forest" : m === b.sand ? "amb.day.beach" : "amb.day.rocky"; }
export class AmbienceDirector {
  private next: Record<string, number> = {}; private t = 0;
  constructor(private rng: () => number = Math.random) {}
  private due(k: string, lo: number, hi: number): boolean { const n = this.next[k]; if (n === undefined) { this.next[k] = this.t + lo * 0.5 + this.rng() * (hi - lo) * 0.5; return false; } if (this.t < n) return false; this.next[k] = this.t + lo + this.rng() * (hi - lo); return true; }
  step(i: AmbienceInput): { loops: LoopSpec[]; events: SoundEvent[] } {
    this.t += i.dt; const loops: LoopSpec[] = []; const events: SoundEvent[] = []; if (!i.inGame) return { loops, events };
    const day = daylight(i.dayFrac); const wet = i.weather === WEATHER.Rain || i.weather === WEATHER.Storm;
    const wx = Math.max(0.25, Math.min(1, i.intensity || 0.6)); const inside = i.indoors ? 0.45 : 1;
    if (day > 0) loops.push({ id: "bed.day", key: dayBedKey(i.biome), gain: day * (wet ? 0.5 : 1) * inside });
    if (day < 1) loops.push({ id: "bed.night", key: i.biome.forest > 0.3 ? "amb.night.forest" : "amb.night", gain: (1 - day) * (wet ? 0.5 : 1) * inside });
    if (i.biome.water > 0.08) loops.push({ id: "bed.shore", key: "amb.water.shore", gain: Math.min(1, i.biome.water * 2.5) * inside });
    if (wet) loops.push({ id: "wx.rain", key: i.indoors ? "weather.rain.indoor" : "weather.rain", gain: wx * (i.weather === WEATHER.Storm ? 1 : 0.75) });
    if (i.weather === WEATHER.Snow) loops.push({ id: "wx.snow", key: "weather.snow", gain: wx * inside });
    const wind = Math.min(1, (i.windSpeed || 0) / 8 + (i.weather === WEATHER.Storm ? 0.5 : 0));
    if (wind > 0.15) loops.push({ id: "wx.wind", key: "weather.wind", gain: wind * inside });
    if (i.indoors) loops.push({ id: "bed.indoor", key: "amb.indoor", gain: 0.6 });
    if (i.weather === WEATHER.Storm && this.due("thunder", 12, 35)) events.push({ key: "weather.thunder", gain: 0.6 + this.rng() * 0.4 });
    if (!i.indoors && !wet) {
      if (day > 0.6 && this.due("bird", 6, 18)) events.push({ key: "amb.bird", gain: 0.5 + this.rng() * 0.5 });
      if (day < 0.3 && this.due("owl", 20, 50)) events.push({ key: "amb.owl", gain: 0.6 });
    }
    if (day < 0.5 && this.due("moan", 25, 70)) events.push({ key: "amb.zombie_distant", gain: (i.indoors ? 0.4 : 0.8) });
    return { loops, events };
  }
}
