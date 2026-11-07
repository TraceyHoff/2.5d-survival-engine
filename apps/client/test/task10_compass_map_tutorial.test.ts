// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { World, Transform } from "@engine/core";
import { InputSystem, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { createIdleTracker, idleCompass } from "../src/compass-hud.js";
import { canvasToWorld, pinchStep, createWorldMap } from "../src/world-map.js";
import { TUTORIAL_STEPS, TutorialProgress } from "../src/tutorial/steps.js";
import { TutorialProber } from "../src/tutorial/probe.js";
import { mountTutorial } from "../src/tutorial/overlay.js";
import type { BindingSource } from "../src/tutorial/labels.js";

const input = (): InputSystem => new InputSystem({ now: () => 0 } as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
const mem = (): { data: Record<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } => ({ data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } });
const stepIdx = (id: string): number => TUTORIAL_STEPS.findIndex((s) => s.id === id);

describe("compass settles north when idle", () => {
  test("moving shows facing; standing still settles north; moving again restores facing", () => {
    const t = createIdleTracker();
    expect(t.isIdle({ x: 0, y: 0 }, 0)).toBe(false); // first sample: moving
    expect(t.isIdle({ x: 0, y: 0 }, 100)).toBe(false); // still, but inside the window
    expect(t.isIdle({ x: 0, y: 0 }, 300)).toBe(true); // stood still past 250 ms
    expect(t.isIdle({ x: 1, y: 0 }, 400)).toBe(false); // moved again
    expect(t.isIdle({ x: 1, y: 0 }, 700)).toBe(true);
  });
  test("slow drift still counts as moving once it leaves the epsilon radius", () => {
    const t = createIdleTracker();
    t.isIdle({ x: 0, y: 0 }, 0);
    expect(t.isIdle({ x: 0.04, y: 0 }, 100)).toBe(false);
    expect(t.isIdle({ x: 0.08, y: 0 }, 200)).toBe(false); // escaped the 0.05 anchor: moving
  });
  test("idle reading is north 0°", () => {
    expect(idleCompass()).toEqual({ heading: 0, dir: "N" });
  });
});

describe("map pinch zoom", () => {
  const W = 480, H = 360, c = { x: 100, y: 50 };
  test("spreading fingers zooms in on the midpoint", () => {
    const s = pinchStep({ centre: c, scale: 8, midPrevPx: 280, midPrevPy: 200, midPx: 280, midPy: 200, canvasW: W, canvasH: H, prevDist: 100, curDist: 200 });
    expect(s.scale).toBe(16);
    // The world point under the midpoint does not move.
    const before = canvasToWorld(280, 200, W, H, c, 8), after = canvasToWorld(280, 200, W, H, s.centre, s.scale);
    expect(after.x).toBeCloseTo(before.x, 9); expect(after.y).toBeCloseTo(before.y, 9);
    expect(s.centre.x).toBeCloseTo(100 + 3.75 * Math.SQRT1_2); expect(s.centre.y).toBeCloseTo(50 - 1.25 * Math.SQRT1_2);
  });
  test("pinching together zooms out; scale clamps to [2, 32]", () => {
    expect(pinchStep({ centre: c, scale: 8, midPrevPx: 240, midPrevPy: 180, midPx: 240, midPy: 180, canvasW: W, canvasH: H, prevDist: 100, curDist: 50 }).scale).toBe(4);
    expect(pinchStep({ centre: c, scale: 24, midPrevPx: 240, midPrevPy: 180, midPx: 240, midPy: 180, canvasW: W, canvasH: H, prevDist: 100, curDist: 200 }).scale).toBe(32);
    expect(pinchStep({ centre: c, scale: 3, midPrevPx: 240, midPrevPy: 180, midPx: 240, midPy: 180, canvasW: W, canvasH: H, prevDist: 100, curDist: 50 }).scale).toBe(2);
  });
  test("dragging both fingers together pans with them", () => {
    const s = pinchStep({ centre: c, scale: 8, midPrevPx: 240, midPrevPy: 180, midPx: 280, midPy: 180, canvasW: W, canvasH: H, prevDist: 100, curDist: 100 });
    expect(s.scale).toBe(8); expect(s.centre.x).toBeCloseTo(100 - 5 * Math.SQRT1_2); expect(s.centre.y).toBeCloseTo(50 + 5 * Math.SQRT1_2);
  });
  test("a pinch gesture never opens the marker form; a tap still does", () => {
    const world = new World(); const player = world.create(); world.add(player, Transform, { x: 10, y: 20, z: 0, facing: 0 });
    const m = createWorldMap({ world: () => world, player: () => player, tiles: () => undefined, send: () => true } as never);
    document.body.append(m.el);
    const canvas = m.el.querySelector('[data-role="map-canvas"]') as HTMLElement;
    const form = m.el.querySelector('[data-role="marker-form"]') as HTMLElement;
    const ev = (type: string, id: number, x: number, y: number): Event => { const e = new Event(type) as Event & { pointerId: number; clientX: number; clientY: number }; e.pointerId = id; e.clientX = x; e.clientY = y; return e; };
    canvas.dispatchEvent(ev("pointerdown", 1, 100, 100)); canvas.dispatchEvent(ev("pointerdown", 2, 200, 100));
    canvas.dispatchEvent(ev("pointermove", 1, 80, 100)); canvas.dispatchEvent(ev("pointermove", 2, 220, 100));
    canvas.dispatchEvent(ev("pointerup", 1, 80, 100)); canvas.dispatchEvent(ev("pointerup", 2, 220, 100));
    expect(form.hidden).toBe(true); // pinched: no accidental marker
    canvas.dispatchEvent(ev("pointerdown", 3, 150, 150)); canvas.dispatchEvent(ev("pointerup", 3, 151, 151));
    expect(form.hidden).toBe(false); // plain tap still places
    m.destroy();
  });
});

describe("tutorial checkpoint gates", () => {
  test("real steps carry the requested checkpoints", () => {
    const build = TUTORIAL_STEPS[stepIdx("build")]!;
    expect(build.gate?.({})).toBe(false); expect(build.gate?.({ "menu:build": 1 })).toBe(true);
    const station = TUTORIAL_STEPS[stepIdx("station")]!;
    expect(station.gate?.({})).toBe(false); expect(station.gate?.({ campfire: 1 })).toBe(true);
    const craftStation = TUTORIAL_STEPS[stepIdx("craft-station")]!;
    expect(craftStation.gate?.({})).toBe(false); expect(craftStation.gate?.({ stationBuilt: 1 })).toBe(true);
    expect(TUTORIAL_STEPS[stepIdx("move")]!.gate).toBeUndefined(); // early steps stay ungated
  });
  test("a gated step waits: no baseline, no advance, until the checkpoint; then it measures from there", () => {
    const p = new TutorialProgress(TUTORIAL_STEPS, mem(), "k"); p.start(); p.go(stepIdx("build"));
    expect(p.gated({})).toBe(true);
    expect(p.observe({ build: 99 })).toBe(false); expect(p.step.id).toBe("build"); // done-signal before the gate does not count
    expect(p.gated({ "menu:build": 1 })).toBe(false);
    expect(p.observe({ "menu:build": 1, build: 99 })).toBe(false); // baseline captured at gate-open
    expect(p.observe({ "menu:build": 1, build: 100 })).toBe(true); expect(p.step.id).toBe("rotate");
  });
  test("prober fires campfire / stationBuilt once when the first nearby one appears", () => {
    const b = new TutorialProber(); const base = { sprinting: false, aiming: false, menuOpen: false, toolKind: 0, buildActive: false, buildRot: 0 };
    b.sample({ ...base, campfires: 0, stations: 0 });
    expect(b.probe()["campfire"]).toBeUndefined(); expect(b.probe()["stationBuilt"]).toBeUndefined();
    b.sample({ ...base, campfires: 1, stations: 1 });
    expect(b.probe()["campfire"]).toBe(1); expect(b.probe()["stationBuilt"]).toBe(1);
    b.sample({ ...base, campfires: 2, stations: 1 }); // more of the same: no refire needed, gate stays open
    expect(b.probe()["campfire"]).toBe(1);
  });
  test("overlay shows the paused chip while gated, and the real card once the checkpoint opens", () => {
    document.body.innerHTML = `<div id="game-root" style="width:390px;height:844px"></div>`;
    const root = document.getElementById("game-root")!;
    const p = new TutorialProgress(TUTORIAL_STEPS, mem(), "k"); p.start(); p.go(stepIdx("build"));
    let probe: Record<string, number> = {};
    const ui = mountTutorial({ root, progress: p, bindings: input() as unknown as BindingSource, device: () => "keyboardMouse", probe: () => probe, hidden: () => false });
    ui.update();
    expect(ui.el.hidden).toBe(false); expect(ui.el.dataset["kind"]).toBe("gated");
    expect(ui.el.textContent).toContain("Open the Build menu"); expect(ui.el.textContent).not.toContain("Pick the campfire");
    (ui.el.querySelector("[data-tut=next]") as HTMLElement).click(); expect(p.step.id).toBe("rotate"); // Skip this step works from the chip
    p.go(stepIdx("build")); probe = { "menu:build": 1 }; ui.update();
    expect(ui.el.dataset["kind"]).toBe("do"); expect(ui.el.textContent).toContain("Pick the campfire");
    ui.destroy();
  });
});
