/**
 * ADR-212 memory budget profiles (JS heap side; GPU texture budgets live in render/gl/capabilities.ts, where console
 * already gets its own streamed atlas budget). Xbox Edge runs the game in a tab with a small, shared memory pool and
 * crashes the tab (no OOM dialog) when the JS heap + GC churn grow, so the console profile is conservative on the things
 * that scale memory/allocation without touching visuals: simulated virtual players (each a full NetClient replica + AI)
 * and P2P host slots. Picked from the UA (Xbox / PlayStation / Nintendo browsers) or forced with `?profile=console`.
 */
export type MemoryProfileName = "desktop" | "console" | "mobile";
export interface MemoryBudget {
  readonly name: MemoryProfileName;
  /** live virtual players in singleplayer (each = own replica world + agent) */ readonly maxBots: number;
  /** P2P host player cap ceiling (host included) */ readonly hostPlayerCap: number;
  /** JS heap (MB) above which the watchdog reports "over budget" */ readonly jsHeapSoftMB: number;
  /** post-GC heap floor slope (MB/min) over a 10+ min window that counts as a leak */ readonly leakSlopeMBPerMin: number;
}
export const MEMORY_BUDGETS: Readonly<Record<MemoryProfileName, MemoryBudget>> = {
  desktop: { name: "desktop", maxBots: 32, hostPlayerCap: 32, jsHeapSoftMB: 1024, leakSlopeMBPerMin: 2 },
  console: { name: "console", maxBots: 12, hostPlayerCap: 8, jsHeapSoftMB: 384, leakSlopeMBPerMin: 1 },
  mobile: { name: "mobile", maxBots: 8, hostPlayerCap: 6, jsHeapSoftMB: 256, leakSlopeMBPerMin: 1 },
};
export const CONSOLE_BROWSER_UA = /xbox|playstation|nintendo/i;

/** Pure: profile from an explicit `?profile=` override, else the UA (console), else mobile/desktop hints. */
export function memoryProfileFor(ua: string, search: string, mobile: boolean): MemoryProfileName {
  let forced: string | null = null; try { forced = new URLSearchParams(search).get("profile"); } catch { /* */ }
  if (forced === "console" || forced === "desktop" || forced === "mobile") return forced;
  if (CONSOLE_BROWSER_UA.test(ua)) return "console";
  return mobile ? "mobile" : "desktop";
}
export function isConsoleHost(): boolean {
  const g = globalThis as { navigator?: { userAgent?: string }; location?: { search?: string } };
  return memoryProfileFor(g.navigator?.userAgent ?? "", g.location?.search ?? "", false) === "console";
}

/**
 * Leak detector over heap samples. A leak raises the post-GC floor; the sawtooth peaks are only allocation rate, and
 * V8 major GCs can be minutes apart, so a short-window minimum is NOT the floor (an old-generation sawtooth looks like
 * a leak). We keep the minimum per window in a fixed ring (the detector never grows), ignore a warm-up period
 * (streaming in the first chunks / bots), and compare the lowest floor of the most recent `span` windows against the
 * lowest floor of the first `span` windows after warm-up: both lows include at least one major GC.
 */
export class HeapTrend {
  private floors: { t: number; mb: number }[] = []; private winStart = -1; private winMin = Infinity; private t0 = -1;
  constructor(private windowMs = 60_000, private maxWindows = 120, private warmupMs = 180_000, private span = 5) {}
  push(tMs: number, usedBytes: number): void {
    if (this.t0 < 0) this.t0 = tMs;
    if (tMs - this.t0 < this.warmupMs) return;
    if (this.winStart < 0) this.winStart = tMs;
    this.winMin = Math.min(this.winMin, usedBytes / 1048576);
    if (tMs - this.winStart >= this.windowMs) {
      this.floors.push({ t: tMs, mb: this.winMin }); if (this.floors.length > this.maxWindows) this.floors.shift();
      this.winStart = tMs; this.winMin = Infinity;
    }
  }
  get windows(): number { return this.floors.length; }
  get lastFloorMB(): number | undefined { return this.floors[this.floors.length - 1]?.mb; }
  private low(from: number, to: number): { t: number; mb: number } {
    let best = this.floors[from]!; for (let i = from + 1; i < to; i++) if (this.floors[i]!.mb < best.mb) best = this.floors[i]!; return best;
  }
  /** Floor growth in MB per minute: lowest of the last `span` windows vs lowest of the first `span` (0 until 2*span windows). */
  slopeMBPerMin(): number {
    const n = this.floors.length, k = this.span; if (n < 2 * k) return 0;
    const a = this.low(0, k), b = this.low(n - k, n); const dt = this.floors[n - 1]!.t - this.floors[k - 1]!.t;
    return dt > 0 ? ((b.mb - a.mb) / dt) * 60_000 : 0;
  }
  /** Leak verdict for a budget: >= 10 min of post-warm-up history and floor growth above the budget's threshold. */
  leaking(b: MemoryBudget): boolean {
    const n = this.floors.length; if (n < 2 * this.span) return false;
    return this.floors[n - 1]!.t - this.floors[0]!.t >= 600_000 && this.slopeMBPerMin() > b.leakSlopeMBPerMin;
  }
}
