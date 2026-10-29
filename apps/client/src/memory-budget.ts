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
 * Leak detector over heap samples: keeps the minimum used heap per window (a proxy for the post-GC floor, which is
 * what a leak raises; the sawtooth peaks are just allocation rate) and fits a least-squares slope over the floors.
 * Fixed-size ring, so the detector itself never grows.
 */
export class HeapTrend {
  private floors: { t: number; mb: number }[] = []; private winStart = -1; private winMin = Infinity;
  constructor(private windowMs = 30_000, private maxWindows = 120) {}
  push(tMs: number, usedBytes: number): void {
    if (this.winStart < 0) this.winStart = tMs;
    this.winMin = Math.min(this.winMin, usedBytes / 1048576);
    if (tMs - this.winStart >= this.windowMs) {
      this.floors.push({ t: tMs, mb: this.winMin }); if (this.floors.length > this.maxWindows) this.floors.shift();
      this.winStart = tMs; this.winMin = Infinity;
    }
  }
  get windows(): number { return this.floors.length; }
  get lastFloorMB(): number | undefined { return this.floors[this.floors.length - 1]?.mb; }
  /** Least-squares slope of the per-window floors in MB per minute (0 with < 3 windows). */
  slopeMBPerMin(): number {
    const n = this.floors.length; if (n < 3) return 0;
    let st = 0, sm = 0; for (const f of this.floors) { st += f.t; sm += f.mb; } const mt = st / n, mm = sm / n;
    let num = 0, den = 0; for (const f of this.floors) { num += (f.t - mt) * (f.mb - mm); den += (f.t - mt) ** 2; }
    return den > 0 ? (num / den) * 60_000 : 0;
  }
  /** Leak verdict for a budget: enough history (>= 10 min) and a floor slope above the budget's threshold. */
  leaking(b: MemoryBudget): boolean {
    const n = this.floors.length; if (n < 3) return false;
    return this.floors[n - 1]!.t - this.floors[0]!.t >= 600_000 && this.slopeMBPerMin() > b.leakSlopeMBPerMin;
  }
}
