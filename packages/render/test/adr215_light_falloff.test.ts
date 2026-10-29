import { describe, expect, it } from "vitest";
import { lightFalloff, FALLOFF_INNER } from "../src/lighting.js";
import { C2D_FALLOFF_STOPS, lightFlicker, lightPeak, lightRadiusPx } from "../src/canvasLight.js";

describe("ADR-215 light falloff profile", () => {
  it("bright core, wide plateau, smooth fade to exactly 0 at the radius", () => {
    expect(lightFalloff(0)).toBeGreaterThan(1.3);
    expect(lightFalloff(FALLOFF_INNER)).toBeGreaterThan(0.95);
    expect(lightFalloff(0.5)).toBeGreaterThan(0.8);   // half way out it is still well lit
    expect(lightFalloff(0.75)).toBeGreaterThan(0.3);  // 3/4 of the radius is visibly lit
    expect(lightFalloff(0.99)).toBeLessThan(0.01); expect(lightFalloff(1)).toBe(0); expect(lightFalloff(2)).toBe(0);
    let prev = Infinity; for (let t = 0; t <= 1; t += 0.01) { const v = lightFalloff(t); expect(v).toBeLessThanOrEqual(prev + 1e-9); prev = v; }
  });
  it("is much wider than the old (1-d^2)^2 + core profile", () => {
    const old = (t: number) => { const d = t * t; return (1 - d) ** 2 + Math.exp(-d * 9) * 0.6; };
    const area = (f: (t: number) => number) => { let a = 0; for (let t = 0.005; t < 1; t += 0.01) a += f(t) * t; return a; };
    expect(area(lightFalloff) / area(old)).toBeGreaterThan(1.2);
  });
  it("canvas gradient stops follow the profile and are normalised", () => {
    expect(C2D_FALLOFF_STOPS[0]).toEqual([0, 1]); expect(C2D_FALLOFF_STOPS.at(-1)).toEqual([1, 0]);
    for (const [t, v] of C2D_FALLOFF_STOPS) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); expect(v).toBeCloseTo(lightFalloff(t) / lightFalloff(0), 6); }
  });
  it("canvas radius matches the WebGL LightPass (iso, tiles -> px)", () => { expect(lightRadiusPx(8, 64)).toBeCloseTo(8 * 32 * 1.414, 6); });
  it("flicker is bounded and deterministic; peak colour clamps", () => {
    for (let t = 0; t < 5; t += 0.07) { const f = lightFlicker(t, 100, 50, 0.55); expect(Math.abs(f)).toBeLessThanOrEqual(0.55); expect(f).toBe(lightFlicker(t, 100, 50, 0.55)); }
    expect(lightFlicker(1, 0, 0, 0)).toBe(0);
    const pk = lightPeak([1, 0.6, 0.29], 1.3, 1, 0); expect(pk[0]).toBe(1); expect(pk[1]).toBeGreaterThan(0.5); expect(pk[2]).toBeGreaterThan(0.2);
  });
});

import { lightKnee } from "../src/composite.js";
describe("ADR-215 composite light knee", () => {
  it("identity up to 1, compresses above while keeping the hue, bounded", () => {
    expect(lightKnee([0.5, 0.3, 0.1])).toEqual([0.5, 0.3, 0.1]); expect(lightKnee([1, 0.6, 0.3])).toEqual([1, 0.6, 0.3]);
    const k = lightKnee([2, 1.2, 0.6]); expect(k[0]).toBeLessThan(2); expect(k[0]).toBeGreaterThan(1); expect(k[1] / k[0]).toBeCloseTo(0.6, 9);
    expect(lightKnee([100, 0, 0])[0]).toBeLessThan(1.63);
  });
});
