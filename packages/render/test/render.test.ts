import { describe, it, expect } from "vitest";
import { World, TimeOfDay } from "@engine/core";
import { NullRenderer, isoZDepthFactor, computeDayLighting, weatherTargets, WeatherState, RENDER_COMPONENTS, Sprite } from "../src/index.js";

describe("render", () => {
  it("NullRenderer counts frames", () => {
    const r = new NullRenderer(); const w = new World(); r.render(); r.render(); void w; expect(r.frames).toBe(2);
  });
  it("depth z-factor is 1/3 for 64x32x16", () => { expect(isoZDepthFactor()).toBeCloseTo(1 / 3, 6); });
  it("night is darker than noon and has no shadows", () => {
    const n = computeDayLighting(23 / 24), d = computeDayLighting(0.5);
    expect(n.ambient[0] + n.ambient[1] + n.ambient[2]).toBeLessThan(d.ambient[0] + d.ambient[1] + d.ambient[2]);
    expect(n.shadowAlpha).toBeLessThan(0.06); expect(d.shadowAlpha).toBeGreaterThan(0);
  });
  it("weather smoothing converges toward target", () => {
    const s = new WeatherState(); const t = weatherTargets(1, 1);
    for (let i = 0; i < 600; i++) s.update(t, 1 / 60);
    expect(s.rain).toBeGreaterThan(0.99); expect(s.fog).toBeGreaterThan(0.3);
  });
  it("render components register on a core World", () => {
    const w = new World(); w.env(TimeOfDay).dayLengthTicks = 100;
    for (const c of RENDER_COMPONENTS) w.register(c);
    const e = w.create(); w.add(e, Sprite, { frameId: 3, scale: 1 });
    expect(w.get(e, Sprite)?.frameId).toBe(3);
  });
});
