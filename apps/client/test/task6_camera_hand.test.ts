// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { rotateCrossfadeAt, ROTATE_CROSSFADE_MIN_SCALE, spinEase, attachCameraRotate } from "../src/camera-rotate.js";
import { TOOL_HINT_LIFT } from "../src/tool-hint.js";
import { STATION_HINT_LIFT } from "../src/station-hint.js";
import { NODE_BAR_LIFT } from "../src/gather-fx.js";

afterEach(() => { document.body.innerHTML = ""; document.head.querySelectorAll("style").forEach((s) => s.remove()); vi.unstubAllGlobals(); });

describe("rotation transition (no distortion, no blink)", () => {
  it("cross-fade state: opaque and full-size at the start, transparent at the end, uniform scale throughout, never black", () => {
    expect(rotateCrossfadeAt(0)).toEqual({ opacity: 1, scale: 1 });
    expect(rotateCrossfadeAt(1)).toEqual({ opacity: 0, scale: ROTATE_CROSSFADE_MIN_SCALE });
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const f = rotateCrossfadeAt(t);
      expect(f.opacity).toBeGreaterThanOrEqual(0); expect(f.opacity).toBeLessThanOrEqual(1);
      expect(f.scale).toBe(1);
    }
    expect(rotateCrossfadeAt(0.5).opacity).toBe(0.5);
  });
  it("spin easing starts and ends flat (no jump at either end)", () => {
    expect(spinEase(0)).toBe(0); expect(spinEase(1)).toBe(1); expect(spinEase(0.5)).toBe(0.5);
    expect(spinEase(0.1)).toBeLessThan(0.1); expect(spinEase(0.9)).toBeGreaterThan(0.9);
  });
  it("with a screenshot the renderer snaps at once and the old view fades over it (no black frame, no stretch)", () => {
    let raf: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { raf.push(f); return raf.length; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const frame = (t: number): void => { const q = raf; raf = []; q.forEach((f) => f(t)); };
    const el = document.createElement("canvas"); document.body.append(el);
    const overlay = document.createElement("canvas");
    let v = 0; const input = { viewQuarter: 0, pressed: () => false };
    const st = new Map<string, string>(); const store = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, val: string) => void st.set(k, val) };
    const c = attachCameraRotate({ target: () => ({ get viewRotation() { return v; }, setViewRotation(q: number) { v = q; } }), pivot: () => undefined, input, storage: store, spinTarget: () => el, captureTarget: () => overlay, spinMs: 100 });
    c.rotate(1);
    // Renderer + input follow the NEW view immediately (live canvas underneath); the old view is an overlay.
    expect(c.view).toBe(1); expect(v).toBe(1); expect(input.viewQuarter).toBe(1);
    expect(document.body.contains(overlay)).toBe(true); expect(overlay.dataset["role"]).toBe("rotate-fade");
    frame(0); expect(overlay.style.opacity).toBe("1"); expect(overlay.style.transform).toBe("");
    frame(50); expect(overlay.style.opacity).toBe("0.5"); expect(overlay.style.transform).toBe("");
    expect(v).toBe(1); // still the new view underneath, never black
    frame(200); expect(document.body.contains(overlay)).toBe(false); expect(v).toBe(1); expect(input.viewQuarter).toBe(1);
    c.dispose();
  });
  it("without a screenshot the view snaps instantly instead of fading to black", () => {
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { f(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const el = document.createElement("canvas"); document.body.append(el);
    let v = 0; const input = { viewQuarter: 0, pressed: () => false };
    const st = new Map<string, string>(); const store = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, val: string) => void st.set(k, val) };
    const c = attachCameraRotate({ target: () => ({ get viewRotation() { return v; }, setViewRotation(q: number) { v = q; } }), pivot: () => undefined, input, storage: store, spinTarget: () => el, captureTarget: () => undefined, spinMs: 100 });
    c.rotate(1); expect(v).toBe(1); expect(input.viewQuarter).toBe(1);
    expect(document.querySelector("[data-role=rotate-fade]")).toBeNull();
    c.dispose();
  });
});

describe("hand icons vs resource health bars", () => {
  it("hand-icon lifts sit above the node health bar, so the icon never covers a bar", () => {
    expect(TOOL_HINT_LIFT).toBeGreaterThan(NODE_BAR_LIFT);
    expect(STATION_HINT_LIFT).toBeGreaterThan(NODE_BAR_LIFT);
  });
});
