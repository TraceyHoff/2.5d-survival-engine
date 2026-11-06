// ADR-260: Spring is a first-class season after Winter (Summer -> Fall -> Winter -> Spring -> Summer).
import { describe, expect, it } from "vitest";
import { SEASON_COUNT, SEASON_NAMES, SeasonId, seasonFromDays, setSeason, setTimeOfDay, Weather } from "@engine/core";
import { WeatherKind, isSnowing } from "../src/defs.js";
import { defaultDefs, seasonalBaseTemp, weatherAllowed } from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const env = defaultDefs().environment; const st = env.seasons!; const L = st.lengthDays;

describe("ADR-260 spring season", () => {
  it("four seasons of equal length; spring follows winter and precedes summer", () => {
    expect(SEASON_COUNT).toBe(4); expect(SEASON_NAMES).toEqual(["summer", "fall", "winter", "spring"]);
    expect(seasonFromDays(2 * L + 0.1, L, st.blendDays)).toMatchObject({ index: SeasonId.Winter, next: SeasonId.Spring });
    expect(seasonFromDays(3 * L + 0.1, L, st.blendDays)).toMatchObject({ index: SeasonId.Spring, next: SeasonId.Summer });
    expect(seasonFromDays(4 * L + 0.1, L, st.blendDays)).toMatchObject({ index: SeasonId.Summer, year: 1 });
  });
  it("blend windows: winter blends into spring and spring into summer", () => {
    const ws = seasonFromDays(3 * L - st.blendDays / 2, L, st.blendDays);
    expect(ws.index).toBe(2); expect(ws.weights[2]).toBeCloseTo(0.5, 6); expect(ws.weights[3]).toBeCloseTo(0.5, 6); expect(ws.weights[0]).toBe(0);
    const ss = seasonFromDays(4 * L - st.blendDays / 2, L, st.blendDays);
    expect(ss.index).toBe(3); expect(ss.weights[3]).toBeCloseTo(0.5, 6); expect(ss.weights[0]).toBeCloseTo(0.5, 6);
    expect(seasonFromDays(-0.1, L, st.blendDays).index).toBe(3); // negative days wrap into spring
  });
  it("environment.json parses a spring table: mild temps, no snow, no heat waves", () => {
    const sp = st.seasons[3]; expect(sp.key).toBe("spring");
    expect(sp.tempRange[0]).toBeGreaterThan(4.4); expect(sp.tempRange[1]).toBeLessThan(st.seasons[0].tempRange[0]);
    expect(sp.tempRange[0]).toBeGreaterThan(st.seasons[2].tempRange[1]);
    expect(sp.weather.some((d) => isSnowing(d.kind) || d.kind === WeatherKind.Heat)).toBe(false);
    expect(sp.weather.map((d) => d.kind)).toContain(WeatherKind.Rain);
    const mid = seasonFromDays(3 * L + 1.5, L, st.blendDays);
    expect(weatherAllowed(env, mid, WeatherKind.Snow)).toBe(false);
    for (let h = 0; h < 24; h++) { const t = seasonalBaseTemp(env, mid, { t: h / 24, hours: h, day: 10, tickOfDay: 0, dayLengthTicks: 1 }); expect(t).toBeGreaterThanOrEqual(sp.tempRange[0] - 1e-6); expect(t).toBeLessThanOrEqual(sp.tempRange[1] + 1e-6); }
  });
  it("mid-spring weather rolls never snow or heat-wave", () => {
    const w = makeWorld({ liveWeather: true, dayLengthTicks: 1_000_000 }, 3); setSeason(w, 3, 1.5); setTimeOfDay(w, 12);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) { w.env(Weather).endsAtTick = 0; steps(w, 1); seen.add(w.env(Weather).kind); }
    for (const k of seen) { expect(isSnowing(k)).toBe(false); expect(k).not.toBe(WeatherKind.Heat); }
    expect(seen.has(WeatherKind.Rain)).toBe(true);
  });
});
