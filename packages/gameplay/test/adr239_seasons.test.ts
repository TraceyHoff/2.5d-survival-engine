// ADR-239: Summer -> Fall -> Winter cycle, seasonal weather tables (never snow in summer) and seasonal temperatures.
import { describe, expect, it } from "vitest";
import { Season, seasonAt, seasonFromDays, setSeason, setTimeOfDay, timeOfDay, TimeOfDay, Weather, World } from "@engine/core";
import { WeatherKind, isSnowing } from "../src/defs.js";
import { ambientTemperature, defaultDefs, seasonalTemperature, weatherAllowed, worldSeason, PINNED_WEATHER } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const env = defaultDefs().environment; const st = env.seasons!;
const L = st.lengthDays;

describe("ADR-239 season cycle", () => {
  it("balance data drives the cycle; a new world starts in summer", () => {
    expect(L).toBeGreaterThan(0); expect(st.blendDays).toBeLessThanOrEqual(L);
    const w = makeWorld(); const s = w.env(Season);
    expect(s.lengthDays).toBe(L); expect(seasonAt(w).index).toBe(0);
  });
  it("Summer -> Fall -> Winter -> Summer over 3 x lengthDays, weights always sum to 1", () => {
    const seq: number[] = [];
    for (let d = 0; d < 3 * L * 2; d += 0.05) {
      const si = seasonFromDays(d, L, st.blendDays);
      expect(si.weights[0] + si.weights[1] + si.weights[2]).toBeCloseTo(1, 9);
      if (seq.at(-1) !== si.index) seq.push(si.index);
    }
    expect(seq).toEqual([0, 1, 2, 0, 1, 2]);
  });
  it("transitions blend smoothly (no step larger than a small fraction per in-game hour)", () => {
    let prev = seasonFromDays(0, L, st.blendDays).weights, maxStep = 0;
    for (let d = 0; d < 3 * L; d += 1 / 24) {
      const w = seasonFromDays(d, L, st.blendDays).weights;
      for (let i = 0; i < 3; i++) maxStep = Math.max(maxStep, Math.abs(w[i]! - prev[i]!)); prev = w;
    }
    expect(maxStep).toBeLessThan(0.1);
  });
  it("advances with the authoritative day clock (ticks), and setSeason jumps keep the time of day", () => {
    const w = makeWorld({ dayLengthTicks: 200 });
    setTimeOfDay(w, 12, 0); expect(seasonAt(w).index).toBe(0);
    steps(w, 200 * L); expect(seasonAt(w).index).toBe(1);
    steps(w, 200 * L); expect(seasonAt(w).index).toBe(2);
    steps(w, 200 * L); expect(seasonAt(w).index).toBe(0);
    const h = timeOfDay(w).hours; setSeason(w, 2, 1);
    expect(seasonAt(w).index).toBe(2); expect(Math.floor(seasonAt(w).into)).toBe(1); expect(timeOfDay(w).hours).toBeCloseTo(h, 6);
  });
  it("lengthDays 0 = seasons off (always summer)", () => {
    expect(seasonFromDays(123.4, 0, 0).index).toBe(0);
    const w = new World({ seed: 1, maxEntities: 16 }); expect(seasonAt(w).weights).toEqual([1, 0, 0]);
  });
});

describe("ADR-239 seasonal weather", () => {
  const roll = (season: number, n: number, seed = 7): Map<number, number> => {
    const w = makeWorld({ liveWeather: true, dayLengthTicks: 1_000_000 }, seed); setSeason(w, season, 0); setTimeOfDay(w, 12);
    const seen = new Map<number, number>();
    for (let i = 0; i < n; i++) { w.env(Weather).endsAtTick = 0; steps(w, 1); const k = w.env(Weather).kind; seen.set(k, (seen.get(k) ?? 0) + 1); }
    return seen;
  };
  it("summer never snows (thousands of rolls), and uses clear / heat / thunderstorm / rain", () => {
    const s = roll(0, 3000);
    for (const k of s.keys()) expect(isSnowing(k)).toBe(false);
    expect([...s.keys()].sort()).toEqual([WeatherKind.Clear, WeatherKind.Rain, WeatherKind.Storm, WeatherKind.Heat].sort());
  });
  it("fall rolls rain / fog / wind / overcast; winter rolls snow / blizzard / overcast / clear-cold", () => {
    expect([...roll(1, 3000).keys()].sort()).toEqual([WeatherKind.Rain, WeatherKind.Fog, WeatherKind.Windy, WeatherKind.Overcast].sort());
    expect([...roll(2, 3000).keys()].sort()).toEqual([WeatherKind.Snow, WeatherKind.Blizzard, WeatherKind.Overcast, WeatherKind.Clear].sort());
  });
  it("no summer table contains snow, and the loader rejects one", () => {
    expect(st.seasons[0].weather.some((d) => isSnowing(d.kind))).toBe(false);
    expect(weatherAllowed(env, seasonFromDays(0.5, L, st.blendDays), WeatherKind.Snow)).toBe(false);
  });
  it("snow still falling when winter turns into summer is re-rolled at once", () => {
    const w = makeWorld({ liveWeather: true, dayLengthTicks: 400 }); setSeason(w, 2, L - 1); setTimeOfDay(w, 23.9);
    Object.assign(w.env(Weather), { kind: WeatherKind.Blizzard, intensity: 1, endsAtTick: w.tick + 1_000_000 });
    let snowInSummer = 0;
    for (let i = 0; i < 400 * 2; i++) { steps(w, 1); if (worldSeason(w).index === 0 && isSnowing(w.env(Weather).kind)) snowInSummer++; }
    expect(worldSeason(w).index).toBe(0); expect(snowInSummer).toBe(0);
  });
  it("pinned weather (endsAtTick u32 max: admin / ?weather / tests) is left alone", () => {
    const w = makeWorld({ liveWeather: true }); Object.assign(w.env(Weather), { kind: WeatherKind.Snow, endsAtTick: PINNED_WEATHER });
    steps(w, 5); expect(w.env(Weather).kind).toBe(WeatherKind.Snow);
  });
});

describe("ADR-239 seasonal temperature", () => {
  /** Every hour of 40 days of `season`, with every weather in its table at full intensity. */
  const sample = (season: number): { all: number[]; clear: number[] } => {
    const all: number[] = [], clear: number[] = [];
    for (let day = 0; day < 40; day++) for (let h = 0; h < 24; h++) {
      const si = seasonFromDays(season * L + 0.1, L, 0); const time = { t: h / 24, hours: h, day, tickOfDay: 0, dayLengthTicks: 72000 };
      for (const d of st.seasons[season]!.weather) { const v = seasonalTemperature(env, si, time, { kind: d.kind, intensity: 1 }); all.push(v); if (d === st.seasons[season]!.weather[0]) clear.push(v); }
    }
    return { all, clear };
  };
  const pct = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]!; };
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  it("summer ~20..35, fall ~5..18, winter ~-15..3 (5th-95th percentile, any weather)", () => {
    const ranges: [number, number][] = [[20, 35], [5, 18], [-15, 3]];
    for (let s = 0; s < 3; s++) {
      const { all } = sample(s); const [lo, hi] = ranges[s]!;
      expect(pct(all, 0.05)).toBeGreaterThanOrEqual(lo - 2); expect(pct(all, 0.95)).toBeLessThanOrEqual(hi + 2);
      expect(Math.min(...all)).toBeGreaterThanOrEqual(st.seasons[s]!.tempRange[0]); expect(Math.max(...all)).toBeLessThanOrEqual(st.seasons[s]!.tempRange[1]);
      expect(mean(all)).toBeGreaterThan(lo); expect(mean(all)).toBeLessThan(hi);
    }
    expect(mean(sample(0).all)).toBeGreaterThan(mean(sample(1).all) + 10); expect(mean(sample(1).all)).toBeGreaterThan(mean(sample(2).all) + 10);
  });
  it("obvious realistic variation: afternoons warmer than nights, days differ, weather matters", () => {
    for (let s = 0; s < 3; s++) {
      const si = seasonFromDays(s * L + 0.1, L, 0); const at = (day: number, h: number, kind: number = st.seasons[s]!.weather[0]!.kind) => seasonalTemperature(env, si, { t: h / 24, hours: h, day, tickOfDay: 0, dayLengthTicks: 72000 }, { kind, intensity: 1 });
      expect(at(3, 14) - at(3, 3)).toBeGreaterThan(6);
      const noons = Array.from({ length: 10 }, (_, d) => at(d, 13)); expect(Math.max(...noons) - Math.min(...noons)).toBeGreaterThan(1.5);
    }
    const sum = seasonFromDays(0.1, L, 0); const t = { t: 0.55, hours: 13.2, day: 2, tickOfDay: 0, dayLengthTicks: 72000 };
    expect(seasonalTemperature(env, sum, t, { kind: WeatherKind.Heat, intensity: 1 })).toBeGreaterThan(seasonalTemperature(env, sum, t, { kind: WeatherKind.Storm, intensity: 1 }) + 4);
    const win = seasonFromDays(2 * L + 0.1, L, 0);
    expect(seasonalTemperature(env, win, t, { kind: WeatherKind.Blizzard, intensity: 1 })).toBeLessThan(seasonalTemperature(env, win, t, { kind: WeatherKind.Overcast, intensity: 1 }) - 4);
  });
  it("temperature blends continuously across a season change", () => {
    const w = makeWorld({ dayLengthTicks: 2000 }); setSeason(w, 0, L - 1); setTimeOfDay(w, 6);
    let prev = ambientTemperature(w), maxStep = 0;
    for (let i = 0; i < 2000 * 2; i += 10) { steps(w, 10); const v = ambientTemperature(w); maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v; }
    expect(worldSeason(w).index).toBe(1); expect(maxStep).toBeLessThan(0.5);
  });
  it("ambientTemperature follows the season on a live world", () => {
    const w = makeWorld(); setTimeOfDay(w, 14);
    const summer = ambientTemperature(w); setSeason(w, 2, 1); const winter = ambientTemperature(w);
    expect(summer).toBeGreaterThan(18); expect(winter).toBeLessThan(5);
    expect(w.env(TimeOfDay).dayLengthTicks).toBeGreaterThan(0);
  });
});
