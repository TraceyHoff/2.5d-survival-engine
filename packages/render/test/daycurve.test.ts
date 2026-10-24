// ADR-115: continuous, realistic day/night light curve.
import { describe, expect, it } from "vitest";
import { DAY_CURVE, computeDayLighting, dayPhase, dimForWeather, moonIllumination, sunElevation } from "../src/timeOfDay.js";

const sum = (c: readonly number[]) => c[0]! + c[1]! + c[2]!;
describe("ADR-115 day curve", () => {
  it("is a sorted data table spanning night..day", () => {
    for (let i = 1; i < DAY_CURVE.length; i++) expect(DAY_CURVE[i]!.elev).toBeGreaterThan(DAY_CURVE[i - 1]!.elev);
    expect(DAY_CURVE[0]!.elev).toBeLessThanOrEqual(-18); expect(DAY_CURVE.at(-1)!.elev).toBeGreaterThanOrEqual(30);
  });
  it("sun elevation is continuous; phases run through every twilight", () => {
    expect(sunElevation(6)).toBeCloseTo(0); expect(sunElevation(18)).toBeCloseTo(0); expect(sunElevation(12)).toBeGreaterThan(50);
    const seen = new Set<string>(); for (let m = 0; m < 1440; m++) seen.add(dayPhase(sunElevation(m / 60)));
    expect([...seen].sort()).toEqual(["astronomical", "civil", "day", "golden", "nautical", "night"]);
  });
  it("no stepping: per-minute change in ambient/sky/shadow is tiny everywhere", () => {
    let prev = computeDayLighting(0, 3); let maxA = 0, maxS = 0;
    for (let m = 1; m <= 1440; m++) { const d = computeDayLighting(m / 1440, 3);
      for (let k = 0; k < 3; k++) { maxA = Math.max(maxA, Math.abs(d.ambient[k]! - prev.ambient[k]!), Math.abs(d.sky[k]! - prev.sky[k]!)); }
      maxS = Math.max(maxS, Math.abs(d.shadowAlpha - prev.shadowAlpha)); prev = d; }
    expect(maxA).toBeLessThan(0.06); expect(maxS).toBeLessThan(0.03);
  });
  it("warm sunrise/sunset, cool night, neutral day; lights glow at night", () => {
    const rise = computeDayLighting(6.1 / 24), set = computeDayLighting(17.9 / 24), noon = computeDayLighting(0.5), night = computeDayLighting(0);
    for (const d of [rise, set]) expect(d.ambient[0]).toBeGreaterThan(d.ambient[2] * 1.3);
    expect(night.ambient[2]).toBeGreaterThan(night.ambient[0]);
    expect(Math.abs(noon.ambient[0] - noon.ambient[2])).toBeLessThan(0.1);
    expect(night.glow).toBe(1); expect(noon.glow).toBe(0); expect(sum(night.ambient)).toBeLessThan(sum(noon.ambient) / 3);
  });
  it("shadows follow the sun: long at low sun, flipping side from morning to evening", () => {
    const am = computeDayLighting(8 / 24), pm = computeDayLighting(16 / 24), noon = computeDayLighting(0.5);
    expect(Math.sign(am.shadowDir[0])).toBe(-Math.sign(pm.shadowDir[0]));
    expect(Math.hypot(...am.shadowDir)).toBeGreaterThan(Math.hypot(...noon.shadowDir));
  });
  it("moon phases brighten the night; weather dims", () => {
    expect(moonIllumination(0)).toBeCloseTo(0); expect(moonIllumination(14.765)).toBeCloseTo(1);
    expect(sum(computeDayLighting(0, 14.7).ambient)).toBeGreaterThan(sum(computeDayLighting(0, 0).ambient));
    const d = computeDayLighting(0.5); expect(sum(dimForWeather(d, { overcast: 1, storm: 1 }).ambient)).toBeLessThan(sum(d.ambient) * 0.6);
  });
  it("is cheap (< 2 us per call)", () => {
    const t0 = performance.now(); for (let i = 0; i < 20000; i++) computeDayLighting(i / 20000, i); expect((performance.now() - t0) / 20000).toBeLessThan(0.002 * 1000);
  });
});
