// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { focusVisible, markNavFocus, navFocusActive } from "../src/back-history.js";
import { NARROW_TOP_PX } from "../src/build-hud.js";

describe("ADR-142 menu focus ring for pad/keyboard, none for touch", () => {
  it("focus asks for a visible ring only after pad/keyboard navigation; a pointer press clears it", () => {
    const b = document.createElement("button"); document.body.append(b); const spy = vi.spyOn(b, "focus");
    focusVisible(b); expect(spy).toHaveBeenLastCalledWith({ focusVisible: false });
    markNavFocus(); expect(navFocusActive()).toBe(true); focusVisible(b); expect(spy).toHaveBeenLastCalledWith({ focusVisible: true });
    document.dispatchEvent(new Event("pointerdown")); expect(navFocusActive()).toBe(false);
  });
  it("narrow build strip sits below the vitals panel (≈98 px)", () => { expect(NARROW_TOP_PX).toBeGreaterThanOrEqual(100); });
});
