// ADR-104 perf guard: a short headless singleplayer session (server + population + virtual-player bots + vehicles) must
// stay well inside a generous ms/tick budget. The bound is ~10x the measured cost on a dev machine so slow/shared CI
// runners don't flake; it only trips on order-of-magnitude regressions (e.g. per-entity full rewrites, O(n^2) scans).
import { describe, expect, test } from "vitest";
import { runPerfSession } from "../perf/harness.js";

describe("perf budget (headless singleplayer)", () => {
  test("server + 12 bots + vehicles stay under the generous ms/tick budget", async () => {
    const r = await runPerfSession({ seconds: 6, bots: 12, vehicles: 4, warmupSeconds: 1 });
    expect(r.ticks).toBeGreaterThan(50);
    expect(r.totalMsPerTick).toBeLessThan(Number(process.env.PERF_BUDGET_MS ?? 400));
  }, 120_000);
});
