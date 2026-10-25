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
