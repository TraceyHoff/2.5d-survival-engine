import { describe, expect, it } from "vitest";
import { QualityController, QualityGovernor, QUALITY_TIERS, parsePreset } from "../src/quality.js";
const run = (g: { feed(d: number): boolean }, ms: number, dt: number) => { let c = 0; for (let t = 0; t < ms; t += dt) if (g.feed(dt)) c++; return c; };
describe("quality governor", () => {
  it("steps down under sustained slow frames and stops at the lowest tier", () => {
    const g = new QualityGovernor(); run(g, 20000, 50); expect(g.level).toBe(0);
  });
  it("holds at 60 fps (no oscillation in the hysteresis band)", () => {
    const g = new QualityGovernor(2); expect(run(g, 20000, 16.7)).toBe(0); expect(g.level).toBe(2);
  });
  it("steps up only after sustained fast frames, with cooldown", () => {
    const g = new QualityGovernor(0); run(g, 3000, 8); expect(g.level).toBe(0); run(g, 30000, 8); expect(g.level).toBe(QUALITY_TIERS.length - 1);
  });
  it("tiers are monotonic", () => { for (let i = 1; i < QUALITY_TIERS.length; i++) expect(QUALITY_TIERS[i]!.resScale).toBeGreaterThan(QUALITY_TIERS[i - 1]!.resScale); });
  it("fixed presets ignore the governor", () => {
    const q = new QualityController("medium"); expect(q.tier.name).toBe("medium"); expect(run(q, 20000, 50)).toBe(0); expect(q.tier.name).toBe("medium");
    q.preset = "high"; expect(q.tier.name).toBe("ultra"); q.preset = "auto"; expect(q.tier.name).toBe("low");
  });
  it("parses presets", () => { expect(parsePreset("low")).toBe("low"); expect(parsePreset("x")).toBeNull(); });
});
