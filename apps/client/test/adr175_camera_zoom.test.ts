import { describe, expect, it } from "vitest";
import { DESKTOP_ZOOM, ZOOM_FLOOR, defaultZoom, visibleIso } from "../src/camera-zoom.js";

describe("ADR-175 viewport-relative default zoom", () => {
  const pc = visibleIso(1920, 1080);
  it("PC 1920x1080 keeps ADR-100 zoom", () => { expect(defaultZoom(1920, 1080)).toBeCloseTo(DESKTOP_ZOOM, 6); });
  it("same world at other 16:9 sizes (1280x720, 4K)", () => {
    for (const [w, h] of [[1280, 720], [3840, 2160], [2560, 1440]] as const) { const v = visibleIso(w, h); expect(v.w).toBeCloseTo(pc.w, 3); expect(v.h).toBeCloseTo(pc.h, 3); }
  });
  it("phone landscape 844x390 sees at least the PC view on both axes", () => {
    const v = visibleIso(844, 390); expect(v.h).toBeCloseTo(pc.h, 3); expect(v.w).toBeGreaterThanOrEqual(pc.w);
  });
  it("phone portrait 390x844 matches PC's short-side span and is not closer than PC", () => {
    const v = visibleIso(390, 844); expect(v.w).toBeCloseTo(pc.h, 3); expect(v.h).toBeGreaterThanOrEqual(pc.h);
  });
  it("is DPR-independent and orientation-symmetric", () => { expect(defaultZoom(390, 844)).toBeCloseTo(defaultZoom(844, 390), 9); });
  it("clamps tiny/invalid viewports", () => { expect(defaultZoom(100, 50)).toBe(ZOOM_FLOOR); expect(defaultZoom(0, 0)).toBe(DESKTOP_ZOOM); expect(defaultZoom(NaN, 5)).toBe(DESKTOP_ZOOM); });
});
