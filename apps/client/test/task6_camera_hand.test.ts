// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { rotateFadeAt, ROTATE_FADE_OUT, ROTATE_MIN_SCALE, spinEase, attachCameraRotate } from "../src/camera-rotate.js";
import { TOOL_HINT_LIFT } from "../src/tool-hint.js";
import { STATION_HINT_LIFT } from "../src/station-hint.js";
import { NODE_BAR_LIFT } from "../src/gather-fx.js";

afterEach(() => { document.body.innerHTML = ""; document.head.querySelectorAll("style").forEach((s) => s.remove()); vi.unstubAllGlobals(); });

describe("rotation transition (no distortion)", () => {
  it("fade/zoom state: opaque and full-size at both ends, fully faded at the snap point, uniform scale throughout", () => {
    expect(rotateFadeAt(0)).toEqual({ opacity: 1, scale: 1, snapped: false });
    expect(rotateFadeAt(1)).toEqual({ opacity: 1, scale: 1, snapped: true });
    const snap = rotateFadeAt(ROTATE_FADE_OUT);
    expect(snap.opacity).toBe(0); expect(snap.scale).toBe(ROTATE_MIN_SCALE); expect(snap.snapped).toBe(true);
    for (const t of [0, 0.1, 0.2, 0.42, 0.6, 0.8, 1]) {
      const f = rotateFadeAt(t);
      expect(f.opacity).toBeGreaterThanOrEqual(0); expect(f.opacity).toBeLessThanOrEqual(1);
      expect(f.scale).toBeGreaterThanOrEqual(ROTATE_MIN_SCALE); expect(f.scale).toBeLessThanOrEqual(1);
    }
    expect(rotateFadeAt(0.2).snapped).toBe(false); expect(rotateFadeAt(0.6).snapped).toBe(true);
  });
  it("spin easing starts and ends flat (no jump at either end)", () => {
    expect(spinEase(0)).toBe(0); expect(spinEase(1)).toBe(1); expect(spinEase(0.5)).toBe(0.5);
    expect(spinEase(0.1)).toBeLessThan(0.1); expect(spinEase(0.9)).toBeGreaterThan(0.9);
  });
  it("with a spin target the renderer snaps only when fully faded, and the canvas is never stretched", () => {
    let raf: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { raf.push(f); return raf.length; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const frame = (t: number): void => { const q = raf; raf = []; q.forEach((f) => f(t)); };
    const el = document.createElement("canvas"); document.body.append(el);
    let v = 0; const input = { viewQuarter: 0, pressed: () => false };
    const st = new Map<string, string>(); const store = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, val: string) => void st.set(k, val) };
    const c = attachCameraRotate({ target: () => ({ get viewRotation() { return v; }, setViewRotation(q: number) { v = q; } }), pivot: () => undefined, input, storage: store, spinTarget: () => el, spinMs: 100 });
    c.rotate(1); expect(c.view).toBe(1); expect(v).toBe(0); expect(input.viewQuarter).toBe(0);
    frame(0); expect(el.style.opacity).toBe("1"); expect(el.style.transform).toBe("scale(1)");
    frame(20); expect(el.style.opacity).not.toBe("1"); expect(el.style.transform).toMatch(/^scale\(/); expect(v).toBe(0); // fading out, not yet snapped
    frame(50); expect(v).toBe(1); expect(input.viewQuarter).toBe(1); // snapped while faded (50 ms > 42 ms fade-out)
    expect(el.style.transform).toMatch(/^scale\(/); expect(el.style.transform).not.toMatch(/matrix/);
    frame(200); expect(v).toBe(1); expect(input.viewQuarter).toBe(1); expect(el.style.transform).toBe(""); expect(el.style.opacity).toBe(""); // landed, styles cleared
    c.dispose();
  });
});

describe("hand icons vs resource health bars", () => {
  it("hand-icon lifts sit above the node health bar, so the icon never covers a bar", () => {
    expect(TOOL_HINT_LIFT).toBeGreaterThan(NODE_BAR_LIFT);
    expect(STATION_HINT_LIFT).toBeGreaterThan(NODE_BAR_LIFT);
  });
});
