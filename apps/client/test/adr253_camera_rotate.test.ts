// @vitest-environment jsdom
/** ADR-253 client camera rotation: view persistence, camera-relative move/aim against the rendered projection, the
 *  renderer/input sync (player pivot), the ⟲ / ⟳ HUD, and the view-aware overlays / bag compass / audio pan. */
import { describe, expect, it } from "vitest";
import { DEFAULT_ISO, worldToScreen } from "@engine/world";
import { moveVector } from "@engine/gameplay";
import { rotateScreenVec } from "@engine/input";
import { IsoCamera } from "@engine/render";
import { attachCameraRotate, loadView, saveView, normView, stepView, screenDirToWorld, rotateRequest, CAM_ROTATE_CSS } from "../src/camera-rotate.js";
import { bagBearing } from "../src/death-screen.js";
import { pan, spatialize } from "../src/audio/spatial.js";
import { snapOverlayLines } from "../src/snap-overlay.js";
import { isoToCss, camIso } from "../src/world-tools.js";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
/** Screen direction (unit) of a world direction under view q. */
const onScreen = (dx: number, dy: number, q: number) => { const s = worldToScreen(dx, dy, 0, { ...DEFAULT_ISO, view: q }); const l = Math.hypot(s.sx, s.sy); return { x: s.sx / l, y: s.sy / l }; };
const SCREEN_DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0], [Math.SQRT1_2, -Math.SQRT1_2]];

describe("ADR-253 view state", () => {
  it("normalises, steps and persists the quarter next to the zoom in engine-settings", () => {
    expect(normView(5)).toBe(1); expect(normView(-1)).toBe(3); expect(normView(NaN)).toBe(0);
    expect(stepView(3, 1)).toBe(0); expect(stepView(0, -1)).toBe(3);
    const st = mem(); st.setItem("engine-settings", JSON.stringify({ zoom: 1.2 }));
    expect(loadView(st)).toBe(0); saveView(2, st); expect(loadView(st)).toBe(2);
    expect(JSON.parse(st.getItem("engine-settings")!)).toEqual({ zoom: 1.2, view: 2 });
    st.setItem("engine-settings", "{bad"); expect(loadView(st)).toBe(0);
  });
  it("rotateRequest: CW +1, CCW -1, both cancel", () => {
    const p = (s: string[]) => ({ pressed: (a: string) => s.includes(a) });
    expect(rotateRequest(p(["Camera.RotateCW"]))).toBe(1); expect(rotateRequest(p(["Camera.RotateCCW"]))).toBe(-1);
    expect(rotateRequest(p(["Camera.RotateCW", "Camera.RotateCCW"]))).toBe(0); expect(rotateRequest(p([]))).toBe(0);
  });
});

describe("ADR-253 camera-relative control matches what is drawn", () => {
  it("movement: the sim's moveVector of the rotated stick walks the player the same way on screen in every view", () => {
    for (let q = 0; q < 4; q++) for (const [x, y] of SCREEN_DIRS) {
      const m0 = moveVector(0, { x, y }); const ref = onScreen(m0.dx, m0.dy, 0); // what q0 always did
      const [rx, ry] = rotateScreenVec([x, y], q); const m = moveVector(0, { x: rx, y: ry }); const s = onScreen(m.dx, m.dy, q);
      expect(s.x).toBeCloseTo(ref.x, 6); expect(s.y).toBeCloseTo(ref.y, 6);
      if (x === 0 || y === 0) { expect(s.x).toBeCloseTo(x, 6); expect(s.y).toBeCloseTo(y, 6); } // up is up, right is right
    }
  });
  it("stick aim (dirToWorld): same on-screen aim in every view, and it agrees with the walk direction", () => {
    for (let q = 0; q < 4; q++) for (const [x, y] of SCREEN_DIRS) {
      const w = screenDirToWorld(x, y, q); expect(Math.hypot(w.x, w.y)).toBeCloseTo(1, 9); const s = onScreen(w.x, w.y, q);
      const w0 = screenDirToWorld(x, y, 0); const ref = onScreen(w0.x, w0.y, 0); expect(s.x).toBeCloseTo(ref.x, 6); expect(s.y).toBeCloseTo(ref.y, 6);
      const m = moveVector(0, { x: rotateScreenVec([x, y], q)[0], y: rotateScreenVec([x, y], q)[1] }); const l = Math.hypot(m.dx, m.dy);
      expect(w.x).toBeCloseTo(m.dx / l, 6); expect(w.y).toBeCloseTo(m.dy / l, 6); // aim and walk agree
      if (x === 0 || y === 0) { expect(s.x).toBeCloseTo(x, 6); expect(s.y).toBeCloseTo(y, 6); }
    }
    expect(screenDirToWorld(0, 0, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("ADR-253 attachCameraRotate", () => {
  const fake = () => { const calls: { q: number; pivot?: { x: number; y: number; z?: number } }[] = []; let v = 0;
    return { calls, t: { get viewRotation() { return v; }, setViewRotation(q: number, pivot?: { x: number; y: number; z?: number }) { v = q; calls.push({ q, ...(pivot ? { pivot } : {}) }); } } }; };
  it("restores the saved view once the renderer exists, pivots on the player and keeps input on what is shown", () => {
    const st = mem(); saveView(3, st); const f = fake(); let ready = false; const seen: number[] = [];
    const input = { viewQuarter: 0, pressed: () => false };
    const c = attachCameraRotate({ target: () => (ready ? f.t : undefined), pivot: () => ({ x: 5, y: 7, z: 0 }), input, storage: st, onChange: (q) => seen.push(q) });
    expect(c.view).toBe(3); expect(input.viewQuarter).toBe(0); // no renderer yet (booting / debug view): input stays q0
    ready = true; c.poll(); expect(f.calls).toEqual([{ q: 3, pivot: { x: 5, y: 7, z: 0 } }]); expect(input.viewQuarter).toBe(3); expect(seen).toEqual([3]);
    c.rotate(1); expect(c.view).toBe(0); expect(input.viewQuarter).toBe(0); expect(loadView(st)).toBe(0);
    c.rotate(-1); expect(c.view).toBe(3); c.set(6); expect(c.view).toBe(2); expect(f.t.viewRotation).toBe(2);
    c.poll(); expect(f.calls.length).toBe(4); // idle polls do not touch the renderer
    c.dispose();
  });
  it("poll reads the bound actions", () => {
    const f = fake(); const held = new Set<string>(); const input = { viewQuarter: 0, pressed: (a: string) => held.has(a) };
    const c = attachCameraRotate({ target: () => f.t, pivot: () => undefined, input, storage: mem() });
    held.add("Camera.RotateCW"); c.poll(); expect(input.viewQuarter).toBe(1); c.poll(); expect(input.viewQuarter).toBe(2);
    held.clear(); held.add("Camera.RotateCCW"); c.poll(); expect(input.viewQuarter).toBe(1); c.dispose();
  });
  it("HUD: two 44 px buttons under the menu bar, clicks rotate without reaching the game", () => {
    const root = document.createElement("div"); document.body.append(root); const f = fake(); const input = { viewQuarter: 0, pressed: () => false };
    let leaked = 0; root.addEventListener("pointerdown", () => leaked++); root.addEventListener("click", () => leaked++);
    const c = attachCameraRotate({ target: () => f.t, pivot: () => undefined, input, storage: mem(), root });
    const box = root.querySelector("#cam-rotate")!; const [ccw, cw] = Array.from(box.querySelectorAll("button"));
    expect(ccw!.dataset["rot"]).toBe("ccw"); expect(cw!.getAttribute("aria-label")).toMatch(/clockwise.*\]/);
    cw!.dispatchEvent(new Event("pointerdown", { bubbles: true })); cw!.click(); expect(c.view).toBe(1); expect(input.viewQuarter).toBe(1);
    ccw!.click(); ccw!.click(); expect(c.view).toBe(3); expect(leaked).toBe(0);
    expect(CAM_ROTATE_CSS).toMatch(/top:calc\(56px/); expect(CAM_ROTATE_CSS).toMatch(/width:44px;height:44px/);
    c.dispose(); expect(root.querySelector("#cam-rotate")).toBeNull();
  });
});

describe("ADR-253 view-aware overlays, compass and audio", () => {
  it("IsoCamera.iso carries the view: overlay helpers follow it (default CameraLike = q0)", () => {
    const cam = new IsoCamera(); cam.setViewport(800, 600, 1); cam.zoom = 1; cam.lookAt(10, 10);
    expect(camIso(cam)).toBe(cam.iso); expect(camIso({})).toBe(DEFAULT_ISO);
    const p0 = isoToCss(cam, 11, 10); expect(p0.x).toBeGreaterThan(400); expect(p0.y).toBeGreaterThan(300); // +x: down-right in q0
    cam.setView(1, { x: 10, y: 10 }); const p1 = isoToCss(cam, 11, 10); const c1 = isoToCss(cam, 10, 10);
    expect(c1.x).toBeCloseTo(400, 6); expect(c1.y).toBeCloseTo(300, 6); // player pivot stays put
    expect(p1.x).toBeLessThan(400); expect(p1.y).toBeGreaterThan(300); // +x: down-left in q1 (world turned clockwise)
    const lines = snapOverlayLines({ outline: [{ x0: 10, y0: 10, x1: 11, y1: 10 }], valid: true, z: 0 } as never, cam);
    expect(lines[0]!.x1).toBeCloseTo(p1.x, 6); expect(lines[0]!.y1).toBeCloseTo(p1.y, 6);
  });
  it("bag compass and stereo pan rotate with the view", () => {
    const me = { x: 0, y: 0 }, bag = { x: 5, y: 0 };
    for (let q = 0; q < 4; q++) { const s = onScreen(5, 0, q); const b = bagBearing(me, bag, q); expect(Math.cos(b.angle)).toBeCloseTo(s.x, 6); expect(Math.sin(b.angle)).toBeCloseTo(s.y, 6); expect(b.dist).toBe(5); }
    expect(bagBearing(me, bag)).toEqual(bagBearing(me, bag, 0));
    for (let q = 0; q < 4; q++) { const s = onScreen(4, 1, q); expect(Math.sign(pan(4, 1, 8, q))).toBe(Math.sign(Math.round(s.x * 1e6))); }
    expect(pan(4, 1)).toBe(pan(4, 1, 8, 0));
    expect(spatialize({ x: 3, y: 0 }, { x: 0, y: 0 }, { view: 2 }).pan).toBeCloseTo(-spatialize({ x: 3, y: 0 }, { x: 0, y: 0 }).pan, 9);
  });
});
