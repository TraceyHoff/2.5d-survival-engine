/** Full Resolution preset: native DPR, soft caps bypassed, Auto behaviour unchanged. */
import { describe, it, expect } from "vitest";
import { QualityController, parsePreset, QUALITY_PRESETS } from "../src/quality.js";
import { clampDrawingBuffer } from "../src/gl/capabilities.js";
import { Canvas2DRenderer } from "../src/canvas2d.js";

const lim = (n: number) => ({ maxTextureSize: n, maxRenderbufferSize: n, maxViewport: [n, n] as [number, number] }) as never;

describe("Full Resolution preset", () => {
  it("is a valid, persisted preset that pins the Ultra tier", () => {
    expect(QUALITY_PRESETS).toContain("full");
    expect(parsePreset("full")).toBe("full");
    const q = new QualityController("full");
    expect(q.fullResolution).toBe(true);
    expect(q.level).toBe(3);
    expect(q.tier.name).toBe("ultra");
    expect(q.tier.resScale).toBe(1);
    expect(q.tier.lightDownscale).toBe(1);
  });
  it("does not let the frame-time governor move it (fixed presets only report Auto changes)", () => {
    const q = new QualityController("full");
    expect(q.feed(100)).toBe(false);
    expect(q.level).toBe(3);
  });
  it("Auto is unchanged: not full-resolution", () => {
    expect(new QualityController("auto").fullResolution).toBe(false);
  });
  it("clampDrawingBuffer bypasses soft DPR / pixel caps, but not hard GPU limits", () => {
    const caps = { maxDpr: 3, maxPixels: 3200000, limits: lim(16384) } as never;
    // 412x915 @ DPR 4: soft cap would give 1236x2745; bypass gives native 1648x3660
    expect(clampDrawingBuffer(412, 915, 4, caps, { bypassSoftCaps: true })).toEqual({ w: 1648, h: 3660, dpr: 4 });
    // Soft caps together: DPR 3, then the 3.2M-pixel budget pulls it to ~2.913x
    expect(clampDrawingBuffer(412, 915, 4, caps)).toEqual({ w: 1200, h: 2666, dpr: 2.9135054452534423 });
    // Hard viewport limit still applies even when bypassing soft caps
    const small = clampDrawingBuffer(3000, 1000, 2, { maxDpr: 3, maxPixels: 1e9, limits: lim(4096) } as never, { bypassSoftCaps: true });
    expect(small.w).toBeLessThanOrEqual(4096);
    expect(small.h).toBeLessThanOrEqual(4096);
  });
  it("Canvas2D fallback uses full DPR only on Full, and keeps the 1.5x cap otherwise", () => {
    const canvas = { width: 0, height: 0 } as unknown as HTMLCanvasElement;
    const r = new Canvas2DRenderer(canvas, {} as unknown as CanvasRenderingContext2D);
    r.resize(100, 50, 3);
    expect(canvas.width).toBe(150);
    r.setQualityPreset("full");
    r.resize(100, 50, 3);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(r.camera.dpr).toBe(3);
    r.setQualityPreset("auto");
    r.resize(100, 50, 3);
    expect(canvas.width).toBe(150);
  });
});
