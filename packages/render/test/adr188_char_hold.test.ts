import { describe, expect, it } from "vitest";
import { ONSCREEN_FRAMES, PageLRU } from "../src/gl/vram.js";
import { layerSource } from "../src/sprites.js";

describe("ADR-188: no partial / flickering paper-doll draws", () => {
  it("LRU never evicts a page drawn this or last frame, not even for the local player (prio 0)", () => {
    const l = new PageLRU<string>(1, 90); l.retain("hair"); l.allocate("hair", 100, 9);
    expect(ONSCREEN_FRAMES).toBe(2); for (const f of [100, 101, 102]) { l.touch("hair", f - 1 < 100 ? 100 : f - 1, 9); expect(l.allocate("me", f, 0)).toBeNull(); }
    expect(l.has("hair")).toBe(true);
    const u = new PageLRU<string>(1, 90); u.allocate("shirt", 200, 400); u.touch("shirt", 900, 400);
    expect(u.allocate("near", 901, 4)).toBeNull(); // on screen: kept even though clearly nearer
  });
  it("an incomplete character keeps its last composite: held frames, never a dropped slot or old/new mix", () => {
    expect(layerSource(true, true, 7, true, 7)).toBe("current");
    expect(layerSource(false, false, 7, true, 7)).toBe("held");   // hair page streaming -> held, not dropped
    expect(layerSource(false, true, 7, true, 9)).toBe("held");    // outfit change: resident new piece waits for the rest
    expect(layerSource(false, true, 7, true, 7)).toBe("current"); // same piece resident: keeps animating
    expect(layerSource(false, true, -1, false, 9)).toBe("partial"); // first sight only
    expect(layerSource(false, false, -1, false, 9)).toBe("skip");
  });
});
