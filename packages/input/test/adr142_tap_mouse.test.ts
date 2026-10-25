import { describe, it, expect } from "vitest";
import { KeyboardMouseDevice, MOUSE_ACTIVITY_PX } from "../src/index.js";

describe("ADR-142 input: tap latch + mouse activity", () => {
  it("a key pressed and released between frames is still seen for one frame", () => {
    const d = new KeyboardMouseDevice(); d.press("key.r"); d.release("key.r");
    expect(d.read("key.r")).toBe(1); d.endFrame(); expect(d.read("key.r")).toBe(0);
  });
  it("re-press before endFrame cancels the deferred release", () => {
    const d = new KeyboardMouseDevice(); d.press("key.r"); d.release("key.r"); d.press("key.r"); d.endFrame();
    expect(d.read("key.r")).toBe(1);
  });
  it("a held key releases immediately", () => {
    const d = new KeyboardMouseDevice(); d.press("key.r"); d.endFrame(); d.release("key.r"); expect(d.read("key.r")).toBe(0);
  });
  it("mouse travel ≥ threshold counts as activity; jitter does not; resets per frame", () => {
    const d = new KeyboardMouseDevice(); d.set("mouse.x", 100); d.set("mouse.y", 100); d.endFrame();
    d.set("mouse.x", 103); expect(d.moved()).toBe(false);
    d.set("mouse.x", 100 + MOUSE_ACTIVITY_PX + 3); expect(d.moved()).toBe(true);
    d.endFrame(); expect(d.moved()).toBe(false);
  });
});

import { FocusManager } from "../src/index.js";
describe("ADR-142 spatial focus: wide buttons are reachable", () => {
  it("down from a right-column button picks the overlapping wide button before a same-column button further down", () => {
    const fm = new FocusManager(); fm.pushScreen("m", true);
    fm.add({ id: "metal", rect: { x: 520, y: 100, w: 120, h: 40 } });
    fm.add({ id: "place", rect: { x: 380, y: 170, w: 260, h: 48 } });
    fm.add({ id: "road", rect: { x: 520, y: 240, w: 120, h: 40 } });
    fm.setFocus("metal"); expect(fm.navigate("down")).toBe("place");
  });
  it("two-column grid: down stays in its column", () => {
    const fm = new FocusManager(); fm.pushScreen("m", true);
    for (const [id, x, y] of [["a", 0, 0], ["b", 130, 0], ["c", 0, 50], ["d", 130, 50]] as const) fm.add({ id, rect: { x, y, w: 120, h: 40 } });
    fm.setFocus("b"); expect(fm.navigate("down")).toBe("d"); fm.setFocus("a"); expect(fm.navigate("right")).toBe("b");
  });
});

import { VirtualControls, MapDevice, DEFAULT_TOUCH_LAYOUTS, TOUCH_EDGE_MARGIN } from "../src/index.js";
describe("ADR-142 touch controls stay on screen", () => {
  for (const [w, h] of [[390, 844], [915, 412], [320, 568]] as const) it(`${w}x${h}: every button fully inside the screen`, () => {
    for (const layout of [DEFAULT_TOUCH_LAYOUTS.gameplay, DEFAULT_TOUCH_LAYOUTS.building]) {
      const vc = new VirtualControls(layout, new MapDevice("t", "touch")); vc.resize({ w, h });
      for (const g of vc.geometry()) if (g.kind !== "joystick") { expect(g.x - g.r, g.id).toBeGreaterThanOrEqual(TOUCH_EDGE_MARGIN - 0.01); expect(g.x + g.r, g.id).toBeLessThanOrEqual(w - TOUCH_EDGE_MARGIN + 0.01); expect(g.y - g.r).toBeGreaterThanOrEqual(0); expect(g.y + g.r).toBeLessThanOrEqual(h); }
    }
  });
});
