import { describe, it, expect } from "vitest";
import { HeapTrend, MEMORY_BUDGETS, memoryProfileFor } from "../src/memory-budget.js";
import { hostPlayerCap } from "../src/p2p.js";
import { defaultMaxBots, DESKTOP_MAX_BOTS } from "../src/local.js";

const XBOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
describe("ADR-212 console memory budget profile", () => {
  it("detects Xbox Edge and honours ?profile=", () => {
    expect(memoryProfileFor(XBOX, "", false)).toBe("console");
    expect(memoryProfileFor("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130", "", false)).toBe("desktop");
    expect(memoryProfileFor("Mozilla/5.0 (Windows NT 10.0) Chrome/130", "?profile=console", false)).toBe("console");
    expect(memoryProfileFor(XBOX, "?profile=desktop", false)).toBe("desktop");
    expect(memoryProfileFor("x", "", true)).toBe("mobile");
  });
  it("console caps bots and P2P host slots below desktop (graphics untouched)", () => {
    const c = MEMORY_BUDGETS.console; expect(c.maxBots).toBeLessThan(DESKTOP_MAX_BOTS); expect(c.jsHeapSoftMB).toBeLessThan(MEMORY_BUDGETS.desktop.jsHeapSoftMB);
    expect(defaultMaxBots({ coarsePointer: false, uaMobile: false, console: true })).toBe(c.maxBots);
    expect(defaultMaxBots({ coarsePointer: false, uaMobile: false })).toBe(DESKTOP_MAX_BOTS);
    expect(hostPlayerCap({ coarsePointer: false, uaMobile: false, console: true }, 20).cap).toBe(c.hostPlayerCap);
  });
  it("HeapTrend flags a rising post-GC floor and ignores a flat sawtooth", () => {
    const flat = new HeapTrend(), leak = new HeapTrend();
    for (let t = 0; t <= 25 * 60_000; t += 1000) {
      const saw = ((t / 1000) % 20) * 4e6; // 0..80 MB of garbage between GCs
      flat.push(t, 100e6 + saw); leak.push(t, 100e6 + saw + (t / 60_000) * 3 * 1048576); // +3 MB/min retained
    }
    expect(Math.abs(flat.slopeMBPerMin())).toBeLessThan(0.1); expect(flat.leaking(MEMORY_BUDGETS.console)).toBe(false);
    expect(leak.slopeMBPerMin()).toBeGreaterThan(2.5); expect(leak.leaking(MEMORY_BUDGETS.console)).toBe(true);
    expect(leak.windows).toBeLessThanOrEqual(120);
  });
  it("an old-generation sawtooth (major GC every ~4 min) and a warm-up ramp are not a leak", () => {
    const tr = new HeapTrend();
    for (let t = 0; t <= 30 * 60_000; t += 5000) {
      const warm = Math.min(t, 180_000) / 180_000 * 120e6; // first 3 min: streaming in chunks/bots
      const old = ((t % 240_000) / 240_000) * 150e6; // old gen climbs 150 MB, then a major GC
      tr.push(t, 90e6 + warm + old + ((t / 1000) % 10) * 3e6);
    }
    expect(Math.abs(tr.slopeMBPerMin())).toBeLessThan(0.5); expect(tr.leaking(MEMORY_BUDGETS.console)).toBe(false);
  });
});
