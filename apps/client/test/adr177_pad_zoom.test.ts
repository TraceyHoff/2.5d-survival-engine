// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { InputSystem, GamepadDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { attachZoom, padZoomStep, USER_ZOOM_MAX, USER_ZOOM_MIN, loadUserZoom } from "../src/camera-zoom.js";
import { actionCombos, combosText, type BindingSource } from "../src/tutorial/labels.js";

const mk = () => { let now = 0; const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const sys = new InputSystem(clock as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
  const pad = new GamepadDevice(0); sys.addDevice(pad); sys.push("Gameplay");
  return { sys, pad, tick: (ms = 16) => { clock.advance(ms); sys.update(); } }; };
/** Simulated navigator.getGamepads() entry (standard mapping: 5 = RB, 12 = D-pad up, 13 = D-pad down). */
const padState = (held: number[]) => ({ index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0, touched: false })) });
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("ADR-177 gamepad camera zoom", () => {
  it("padZoomStep is continuous, frame-rate independent and clamped", () => {
    let a = 1; for (let i = 0; i < 10; i++) a = padZoomStep(a, 1, 16); expect(padZoomStep(1, 1, 160)).toBeCloseTo(a, 6); expect(a).toBeGreaterThan(1);
    expect(padZoomStep(1, 0, 16)).toBe(1);
    let z = 1; for (let i = 0; i < 200; i++) z = padZoomStep(z, 1, 16); expect(z).toBe(USER_ZOOM_MAX);
    for (let i = 0; i < 200; i++) z = padZoomStep(z, -1, 16); expect(z).toBe(USER_ZOOM_MIN);
  });
  it("RB + D-pad ↑/↓ drives Camera.Zoom and shadows the plain D-pad hotbar", () => {
    const { sys, pad, tick } = mk();
    pad.poll(padState([5, 12]) as never); tick(); expect(sys.axis("Camera.Zoom")).toBe(1);
    expect(["Hotbar1", "Hotbar2", "Hotbar3", "Hotbar4"].some((a) => sys.pressed(a))).toBe(false);
    pad.poll(padState([5, 13]) as never); tick(); expect(sys.axis("Camera.Zoom")).toBe(-1);
    pad.poll(padState([13]) as never); tick(); expect(sys.axis("Camera.Zoom")).toBe(0); // no modifier: no zoom
  });
  it("held input zooms smoothly via ZoomControl.nudge and persists", async () => {
    const st = mem(); const cam = { zoom: 0 }; const el = document.createElement("canvas");
    const zc = attachZoom(cam, el, { storage: st, viewport: () => ({ w: 1920, h: 1080 }) });
    const { sys, pad, tick } = mk(); pad.poll(padState([5, 12]) as never);
    const seen: number[] = []; for (let i = 0; i < 30; i++) { tick(); zc.nudge(sys.axis("Camera.Zoom"), 16); seen.push(zc.user); }
    for (let i = 1; i < seen.length; i++) expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.05); // small per-frame steps
    expect(zc.user).toBeGreaterThan(1.4);
    for (let i = 0; i < 200; i++) zc.nudge(1, 16); expect(zc.user).toBe(USER_ZOOM_MAX);
    for (let i = 0; i < 200; i++) zc.nudge(-1, 16); expect(zc.user).toBe(USER_ZOOM_MIN);
    await new Promise((r) => setTimeout(r, 350)); expect(loadUserZoom(st)).toBe(USER_ZOOM_MIN); zc.dispose();
  });
  it("disabled (boot menu) ignores pad zoom", () => {
    const zc = attachZoom({ zoom: 0 }, document.createElement("canvas"), { storage: mem(), enabled: () => false }); zc.nudge(1, 100); expect(zc.user).toBe(1); zc.dispose();
  });
  it("tutorial/controls hint names the pad binding", () => {
    const { sys } = mk(); expect(combosText(actionCombos(sys as unknown as BindingSource, "gamepad", "Camera.Zoom"))).toMatch(/RB|R1|D-pad/);
  });
});
