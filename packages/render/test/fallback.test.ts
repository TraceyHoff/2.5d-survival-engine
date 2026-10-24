import { describe, expect, it, vi } from "vitest";
import { BlankWatchdog, FallbackLadder, FallbackStep, isFlatFrame, nearestCutoff } from "../src/gl/fallback.js";
import { VramAccountant } from "../src/gl/vram.js";
import { IsoRenderer } from "../src/IsoRenderer.js";
import { formatDiagReport, newDiag, type Rgba } from "../src/gl/diag.js";

const flat = (c: Rgba, n = 6): Rgba[] => Array.from({ length: n }, () => [...c] as Rgba);
const varied: Rgba[] = [[10, 20, 30, 255], [140, 200, 90, 255], [80, 120, 60, 255], [200, 190, 180, 255], [30, 90, 40, 255], [90, 90, 90, 255]];

describe("FallbackLadder", () => {
  it("steps down one rung per fault in order, honouring the cooldown", () => {
    const l = new FallbackLadder(30);
    expect(l.fault("page", "oom", 10)).toBe(FallbackStep.EvictWearables);
    expect(l.fault("page", "oom", 20)).toBeNull(); // cooldown
    expect(l.fault("page", "oom", 40)).toBe(FallbackStep.CapDressed);
    expect(l.fault("watchdog", "flat", 80)).toBe(FallbackStep.LowTier);
    expect(l.fault("fbo", "incomplete", 120)).toBe(FallbackStep.Safe);
    expect(l.exhausted).toBe(true);
    expect(l.fault("fbo", "incomplete", 200)).toBeNull();
    expect(l.suppressed).toBe(2);
    const r = l.report().join("\n");
    expect(r).toContain("step 4 (safe)"); expect(r).toContain("page: oom -> evict-wearables"); expect(r).toContain("2 faults suppressed");
  });
  it("atLeast forces a floor (?gl=safe)", () => { const l = new FallbackLadder(); l.atLeast(9); expect(l.step).toBe(FallbackStep.Safe); });
});

describe("BlankWatchdog", () => {
  it("is due every interval after the start frame (whole session, not just start-up)", () => {
    const w = new BlankWatchdog(60, 2, 90);
    expect(w.due(60)).toBe(false); expect(w.due(90)).toBe(true); expect(w.due(150)).toBe(true); expect(w.due(90 + 60 * 500)).toBe(true); expect(w.due(151)).toBe(false);
  });
  it("trips after consecutive flat frames with instances drawn (e.g. flat brown #5a2c28)", () => {
    const w = new BlankWatchdog(60, 2, 0); const brown: Rgba = [0x5a, 0x2c, 0x28, 255];
    expect(w.sample(1, flat([0, 0, 0, 0]), flat(brown), 5000)).toBe(false);
    expect(w.sample(2, flat([0, 0, 0, 0]), flat(brown), 5000)).toBe(true);
    expect(w.trips).toBe(1); expect(w.report()).toContain("#5a2c28");
  });
  it("does not trip on a textured frame, an empty world, or a streak broken by a good frame", () => {
    const w = new BlankWatchdog(60, 2, 0);
    expect(w.sample(1, varied, varied, 5000)).toBe(false);
    expect(w.sample(2, flat([0, 0, 0, 255]), flat([0, 0, 0, 255]), 0)).toBe(false); // nothing drawn
    expect(w.sample(3, flat([1, 1, 1, 255]), flat([1, 1, 1, 255]), 10)).toBe(false);
    expect(w.sample(4, varied, varied, 10)).toBe(false);
    expect(w.sample(5, flat([1, 1, 1, 255]), flat([1, 1, 1, 255]), 10)).toBe(false);
    expect(w.trips).toBe(0);
  });
  it("isFlatFrame tolerance", () => { expect(isFlatFrame([[10, 10, 10, 255], [11, 12, 9, 255]])).toBe(true); expect(isFlatFrame([[10, 10, 10, 255], [20, 10, 10, 255]])).toBe(false); });
});

describe("nearest dressed cutoff", () => {
  it("keeps the nearest N", () => {
    const d = new Float32Array([400, 25, 9, 100, 1]);
    expect(nearestCutoff(d, 5, 3)).toBe(25);
    expect(nearestCutoff(d, 5, 5)).toBe(Infinity);
    expect(nearestCutoff(d, 5, Infinity)).toBe(Infinity);
    expect(nearestCutoff(d, 5, 0)).toBe(-1);
  });
});

describe("VramAccountant counts wearable pages against the budget", () => {
  it("refuses page-ins past the budget even when pool storage was forced over it", () => {
    const v = new VramAccountant(100); v.setResident(80, 40); // forced pool layer: allocated 120 > budget 100
    expect(v.withinBudget).toBe(false);
    expect(v.canPageIn(15)).toBe(true); v.pageIn(15);
    expect(v.canPageIn(15)).toBe(false);
    v.evict(15); expect(v.canPageIn(15)).toBe(true);
  });
});

describe("IsoRenderer fallback wiring", () => {
  const fake = () => {
    const calls: string[] = [];
    const o = {
      fallback: new FallbackLadder(30), totalFrames: 0, diagState: newDiag(true, false), capabilities: { fallbacks: [] as string[], safe: false },
      atlas: { setWearables: vi.fn((on: boolean) => calls.push(`wearables:${on}`)), forceLowTier: vi.fn(async () => { calls.push("lowTier"); }) },
      sprites: { maxDressed: Infinity },
      emit: vi.fn(), diagReport: () => "report", w: 100,
      enterSafe: vi.fn((why: string) => calls.push(`safe:${why}`)),
      applyFallback: (IsoRenderer.prototype as unknown as { applyFallback: (s: number) => void }).applyFallback,
    };
    return { o, calls, fault: (s: string, d: string) => (IsoRenderer.prototype.fault as (s: string, d: string) => void).call(o, s, d) };
  };
  it("evict wearables -> cap dressed -> low tier -> safe, one step per fault", async () => {
    const { o, calls, fault } = fake();
    fault("page", "page-in x: OUT_OF_MEMORY"); expect(calls).toEqual(["wearables:false"]); expect(o.sprites.maxDressed).toBe(Infinity);
    o.totalFrames = 40; fault("page", "again"); expect(o.sprites.maxDressed).toBe(IsoRenderer.DRESS_CAP);
    o.totalFrames = 80; fault("watchdog", "flat"); expect(o.atlas.forceLowTier).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve(); expect(o.w).toBe(0); // targets re-created after the rebuild
    o.totalFrames = 120; fault("fbo", "scene INCOMPLETE_ATTACHMENT"); expect(o.enterSafe).toHaveBeenCalled();
    expect(o.emit).toHaveBeenCalledTimes(4); expect(o.emit.mock.calls[0]![0].kind).toBe("oom");
    expect(o.capabilities.fallbacks.join(";")).toContain("runtime fallback: safe");
    expect(o.atlas.forceLowTier).toHaveBeenCalledTimes(1);
  });
  it("cooldown: a burst of faults in one frame moves a single step", () => {
    const { o, fault } = fake();
    for (let i = 0; i < 20; i++) fault("page", "oom");
    expect(o.fallback.step).toBe(FallbackStep.EvictWearables); expect(o.diagState.messages.length).toBeLessThanOrEqual(16);
  });
});

describe("diag report", () => { it("still formats", () => { expect(formatDiagReport(newDiag(true, false), { renderer: "x", mobile: true, precision: "highp", budgetMB: 256, fallbacks: [], problems: [] })).toContain("render diag"); }); });
