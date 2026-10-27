import { describe, it, expect, afterEach, vi } from "vitest";
import { AtlasManager, resizeImage, resizeStats, setResizeYield, sliced, RESIZE_SLICE_MS, RETIER_CONFIRM } from "../src/assets/atlasManager.js";

/** ADR-190: atlas re-tier no longer freezes (memoized + time-sliced resizes, hysteresis, busy guard). */
afterEach(() => { setResizeYield(null); vi.unstubAllGlobals(); });

describe("time-sliced memoized resizes", () => {
  it("identical results: a second rebuild reuses the exact same resized images (no re-run)", async () => {
    let n = 0; vi.stubGlobal("createImageBitmap", async (_im: unknown, o: { resizeWidth: number; resizeHeight: number }) => ({ width: o.resizeWidth, height: o.resizeHeight, id: n++ }));
    const src = { width: 256, height: 256 }; const r0 = { ...resizeStats };
    const a = await resizeImage(src as never, 128, 128, "high"); const b = await resizeImage(src as never, 128, 128, "high");
    expect(b).toBe(a); expect(resizeStats.runs - r0.runs).toBe(1); expect(resizeStats.hits - r0.hits).toBe(1);
    const c = await resizeImage(src as never, 128, 128, "pixelated"); expect(c).not.toBe(a); // filter is part of the key
  });
  it("simulated run: no frame carries more than RESIZE_SLICE_MS (+1 job) of resize work, far under 50ms", async () => {
    let clock = 0; const perFrame: number[] = [0];
    setResizeYield(async () => { perFrame.push(0); }, () => clock);
    const jobs = Array.from({ length: 120 }, () => sliced(() => { clock += 3; perFrame[perFrame.length - 1]! += 3; }));
    await Promise.all(jobs);
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(RESIZE_SLICE_MS + 3);
    expect(Math.max(...perFrame)).toBeLessThan(50);
    expect(perFrame.reduce((s, x) => s + x, 0)).toBe(360); // all work done, in order
  });
});

describe("re-tier hysteresis", () => {
  function am(): any {
    const gl = { canvas: undefined, getParameter: () => 4096, isContextLost: () => false, getError: () => 0 } as never;
    const a = new AtlasManager(gl, { registerLoader: () => {} } as never, { textureBudgetMB: 128 }) as any;
    a.atlases = []; a.registry = {}; return a;
  }
  it("needs RETIER_CONFIRM consecutive positive checks; a blip resets", async () => {
    const a = am(); let need = true; Object.defineProperty(a, "needsRetier", { get: () => need });
    let rebuilds = 0; a.rebuild = async () => { rebuilds++; };
    let f = 100000;
    for (let i = 0; i < RETIER_CONFIRM - 1; i++) expect(await a.retier((f += 30))).toBe(false);
    need = false; await a.retier((f += 30)); need = true;
    for (let i = 0; i < RETIER_CONFIRM - 1; i++) expect(await a.retier((f += 30))).toBe(false);
    expect(await a.retier((f += 30))).toBe(true); expect(rebuilds).toBe(1);
    for (let i = 0; i < 10; i++) await a.retier((f += 30)); // min gap
    expect(rebuilds).toBe(1);
  });
  it("never starts a second rebuild while one is in flight", async () => {
    const a = am(); Object.defineProperty(a, "needsRetier", { get: () => true });
    let rebuilds = 0; let done!: () => void; a.rebuild = () => { rebuilds++; return new Promise<void>((r) => (done = r)); };
    const ps: Promise<boolean>[] = []; for (let i = 0; i < RETIER_CONFIRM; i++) ps.push(a.retier(100000 + i, 0));
    for (let i = 0; i < 10; i++) expect(await a.retier(200000 + i, 0)).toBe(false);
    expect(rebuilds).toBe(1); done(); await Promise.all(ps);
  });
});
