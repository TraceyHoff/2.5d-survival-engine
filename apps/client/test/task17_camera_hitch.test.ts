// Task 17, Problem A: menu-close judder. No sim / net / interpolation branch on
// menu state exists (see the investigation in the report), so the visible carrier
// is the camera: it follows the player, and every entity on screen — animals,
// zombies, AI humans, players — moves with it. A hitch frame on menu close (DOM
// teardown) used to ease the camera with dt up to 0.25 s, nearly snapping it to
// the moving target in one frame (k≈0.96) so the whole screen jumped. The view
// now caps the easing dt at CAM_DT_CAP_S (one tick); these tests pin that.
import { describe, expect, it } from "vitest";
import { CAM_DT_CAP_S, CAM_XY_SNAP, CAM_XY_TAU, stepCameraXY } from "../src/view.js";

describe("Task 17: camera hitch guard", () => {
  it("the easing dt cap is one sim tick", () => {
    expect(CAM_DT_CAP_S).toBe(0.05);
  });
  it("first frame and teleports still snap exactly", () => {
    expect(stepCameraXY(undefined, { x: 10, y: 20 }, 1 / 60)).toEqual({ x: 10, y: 20 });
    expect(stepCameraXY({ x: 0, y: 0 }, { x: CAM_XY_SNAP + 1, y: 0 }, 1 / 60)).toEqual({ x: CAM_XY_SNAP + 1, y: 0 });
  });
  it("a normal frame eases part-way (no snap, no stall)", () => {
    const cur = { x: 0, y: 0 };
    const out = stepCameraXY(cur, { x: 1, y: 0 }, 1 / 60);
    const k = 1 - Math.exp(-(1 / 60) / CAM_XY_TAU);
    expect(out.x).toBeCloseTo(k, 10);
    expect(out).toBe(cur); // ease mutates in place (no per-frame allocation)
  });
  it("a menu-close hitch frame (250 ms gap) capped to one tick moves less than half the gap", () => {
    const gap = 2; // player kept moving while the menu was open
    const uncapped = stepCameraXY({ x: 0, y: 0 }, { x: gap, y: 0 }, 0.25);
    expect(uncapped.x / gap).toBeGreaterThan(0.95); // the old behaviour: a near-snap
    const capped = stepCameraXY({ x: 0, y: 0 }, { x: gap, y: 0 }, Math.min(CAM_DT_CAP_S, 0.25));
    expect(capped.x / gap).toBeLessThan(0.5); // the fix: at most one tick's ease
    expect(capped.x / gap).toBeCloseTo(1 - Math.exp(-CAM_DT_CAP_S / CAM_XY_TAU), 10);
  });
  it("repeated normal frames still converge on a moving target", () => {
    let cur = { x: 0, y: 0 };
    for (let i = 0; i < 40; i++) cur = stepCameraXY(cur, { x: 1, y: 0 }, 1 / 60);
    expect(Math.abs(cur.x - 1)).toBeLessThan(0.01);
  });
});
