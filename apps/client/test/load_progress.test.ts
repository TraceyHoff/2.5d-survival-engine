import { describe, expect, test } from "vitest";
import { BOOT_STAGES, EasedBar, LoadProgress, countFraction, zombiePose } from "../src/load-progress.js";

describe("LoadProgress (ADR-118)", () => {
  test("weights sum to 1 and stages advance in order", () => {
    expect(BOOT_STAGES.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 6);
    const p = new LoadProgress();
    expect(p.value).toBe(0);
    p.update("atlases", 0.5);
    expect(p.value).toBeCloseTo(0.08 + 0.1 + 0.26, 6); // renderer + manifest done, half atlases
    expect(p.label).toBe("Loading sprite atlases");
  });
  test("monotonic: lower or earlier reports never move it back", () => {
    const p = new LoadProgress(); p.update("lighting", 0.5); const v = p.value;
    p.update("manifest", 0.1); p.update("lighting", 0.2); p.update("lighting", Number.NaN); p.update("nope", 1);
    expect(p.value).toBeGreaterThanOrEqual(v);
  });
  test("complete reaches exactly 1", () => { const p = new LoadProgress(); p.update("manifest", 1); expect(p.complete()).toBe(1); expect(p.label).toBe("Ready"); });
  test("countFraction caps below 1 and handles unknown totals", () => {
    expect(countFraction(5, 10)).toBe(0.5); expect(countFraction(50, 10)).toBe(0.97); expect(countFraction(0, 0)).toBe(0); expect(countFraction(3, 0)).toBe(0.97);
  });
});

describe("EasedBar", () => {
  test("eases smoothly, monotonic, lands on target", () => {
    const b = new EasedBar(); b.set(0.6); let prev = 0; const seen: number[] = [];
    for (let i = 0; i < 240; i++) { const v = b.step(1 / 60); expect(v).toBeGreaterThanOrEqual(prev); prev = v; seen.push(v); }
    expect(seen[0]).toBeLessThan(0.2); expect(b.shown).toBe(0.6);
    b.set(0.3); b.step(1 / 60); expect(b.shown).toBe(0.6); // never backwards
    b.set(1); for (let i = 0; i < 240 && !b.done; i++) b.step(1 / 60); expect(b.done).toBe(true);
  });
  test("reduced motion snaps", () => { const b = new EasedBar(true); b.set(0.42); expect(b.step(0.016)).toBe(0.42); });
  test("huge dt (background tab) is clamped, not overshooting", () => { const b = new EasedBar(); b.set(0.5); expect(b.step(10)).toBeLessThanOrEqual(0.5); });
});

describe("zombiePose", () => {
  test("walks while moving, idle otherwise, still under reduced motion", () => {
    const frames = new Set<number>(); for (let t = 0; t < 1; t += 0.05) frames.add(zombiePose(t, true, false).frame);
    expect(frames.size).toBe(6); expect(Math.min(...[0.1, 0.2, 0.3].map((t) => zombiePose(t, true, false).bob))).toBeLessThan(0);
    expect(zombiePose(0.3, false, false)).toEqual({ frame: 0, bob: 0 }); expect(zombiePose(0.3, true, true)).toEqual({ frame: 0, bob: 0 });
  });
});
