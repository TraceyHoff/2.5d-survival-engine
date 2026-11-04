// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ISO, worldToScreen } from "@engine/world";
import { rotateTransitionMatrix, spinEase, attachCameraRotate } from "../src/camera-rotate.js";
import { TOOL_HINT_LIFT } from "../src/tool-hint.js";
import { STATION_HINT_LIFT } from "../src/station-hint.js";
import { NODE_BAR_LIFT } from "../src/gather-fx.js";

afterEach(() => { document.body.innerHTML = ""; document.head.querySelectorAll("style").forEach((s) => s.remove()); vi.unstubAllGlobals(); });

describe("rotation transition matrix", () => {
  it("identity at 0, quarter-turn maps at ±90°", () => {
    expect(rotateTransitionMatrix(0)).toEqual([1, 0, 0, 1]);
    const [a, b, c, d] = rotateTransitionMatrix(Math.PI / 2);
    expect(a).toBeCloseTo(0, 9); expect(b).toBeCloseTo(0.5, 9); expect(c).toBeCloseTo(-2, 9); expect(d).toBeCloseTo(0, 9);
    const [a2, b2, c2, d2] = rotateTransitionMatrix(-Math.PI / 2);
    expect(a2).toBeCloseTo(0, 9); expect(b2).toBeCloseTo(-0.5, 9); expect(c2).toBeCloseTo(2, 9); expect(d2).toBeCloseTo(0, 9);
  });
  it("the 90° matrix maps a q0 screen point onto its q1 screen point", () => {
    const [a, b, c, d] = rotateTransitionMatrix(Math.PI / 2);
    for (const [x, y] of [[3, 1], [0, 5], [-2, 4], [7, -3]] as const) {
      const s0 = worldToScreen(x, y, 0, { ...DEFAULT_ISO, view: 0 });
      const s1 = worldToScreen(x, y, 0, { ...DEFAULT_ISO, view: 1 });
      expect(a * s0.sx + c * s0.sy).toBeCloseTo(s1.sx, 6);
      expect(b * s0.sx + d * s0.sy).toBeCloseTo(s1.sy, 6);
    }
  });
  it("spin easing starts and ends flat (no jump at either end)", () => {
    expect(spinEase(0)).toBe(0); expect(spinEase(1)).toBe(1); expect(spinEase(0.5)).toBe(0.5);
    expect(spinEase(0.1)).toBeLessThan(0.1); expect(spinEase(0.9)).toBeGreaterThan(0.9);
  });
  it("with a spin target the renderer snaps only when the spin finishes", () => {
    let raf: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { raf.push(f); return raf.length; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const frame = (t: number): void => { const q = raf; raf = []; q.forEach((f) => f(t)); };
    const el = document.createElement("canvas"); document.body.append(el);
    let v = 0; const input = { viewQuarter: 0, pressed: () => false };
    const st = new Map<string, string>(); const store = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, val: string) => void st.set(k, val) };
    const c = attachCameraRotate({ target: () => ({ get viewRotation() { return v; }, setViewRotation(q: number) { v = q; } }), pivot: () => undefined, input, storage: store, spinTarget: () => el, spinMs: 100 });
    c.rotate(1); expect(c.view).toBe(1); expect(v).toBe(0); expect(input.viewQuarter).toBe(0); // spinning, renderer still old
    frame(0); expect(el.style.transform).toMatch(/^matrix\(/);
    frame(50); expect(el.style.transform).not.toBe(""); expect(v).toBe(0);
    frame(200); expect(v).toBe(1); expect(input.viewQuarter).toBe(1); expect(el.style.transform).toBe(""); // landed, transform cleared
    c.dispose();
  });
});

describe("hand icons vs resource health bars", () => {
  it("hand-icon lifts sit above the node health bar, so the icon never covers a bar", () => {
    expect(TOOL_HINT_LIFT).toBeGreaterThan(NODE_BAR_LIFT);
    expect(STATION_HINT_LIFT).toBeGreaterThan(NODE_BAR_LIFT);
  });
});
