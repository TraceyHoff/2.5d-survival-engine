/** ADR-244: contextual touch carry / sleep buttons and their live captions. */
import { describe, expect, it } from "vitest";
import { syncTouchHidden, touchLabel, TOUCH_LABELS } from "../src/touch-overlay.js";

describe("ADR-244 touch context", () => {
  it("carry shows only near a liftable bag or while carrying; sleep only near a bed or while asleep", () => {
    const h = new Set<string>();
    syncTouchHidden(h, { reload: false }); expect([...h].sort()).toEqual(["carry", "reload", "sleep"]);
    syncTouchHidden(h, { reload: false, carry: true }); expect(h.has("carry")).toBe(false); expect(h.has("sleep")).toBe(true);
    syncTouchHidden(h, { reload: true, carrying: true, sleep: true }); expect(h.size).toBe(0);
    syncTouchHidden(h, { reload: false, sleeping: true }); expect(h.has("sleep")).toBe(false); expect(h.has("carry")).toBe(true);
  });
  it("captions flip to Drop / Wake / Aim", () => {
    expect(touchLabel("carry", { reload: false })).toBe(TOUCH_LABELS.carry); expect(touchLabel("carry", { reload: false, carrying: true })?.text).toBe("Drop");
    expect(touchLabel("sleep", { reload: false, sleeping: true })?.text).toBe("Wake"); expect(touchLabel("secondary", { reload: false, aim: true })?.text).toBe("Aim");
    expect(touchLabel("secondary", { reload: false })?.text).toBe("Block"); expect(touchLabel("crouch", { reload: false })?.text).toBe("Crouch");
  });
});
