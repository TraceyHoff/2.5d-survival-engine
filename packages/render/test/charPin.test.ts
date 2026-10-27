import { describe, it, expect } from "vitest";
import { PageLRU, PRIO_NEAR, LIVE_MIN_RESIDENT_FRAMES } from "../src/gl/vram.js";

describe("ADR-123: visible characters' wear/face pages are pinned", () => {
  it("a farther-than-near request cannot steal a live retained page (no dressed<->body flicker between crowds)", () => {
    const l = new PageLRU<string>(1, 90); l.retain("wearA"); l.allocate("wearA", 100, 400);
    expect(l.allocate("wearB", 101, 100)).toBeNull();
    expect(l.has("wearA")).toBe(true);
  });
  it("an unretained live page is still taken by a nearer request; the local player / near characters may take pinned pages", () => {
    const l = new PageLRU<string>(1, 90); l.allocate("a", 100, 400); l.touch("a", 100 + LIVE_MIN_RESIDENT_FRAMES, 400);
    expect(l.allocate("b", 100 + LIVE_MIN_RESIDENT_FRAMES + 3, 100)?.evicted).toBe("a");
    const p = new PageLRU<string>(1, 90); p.retain("far"); p.allocate("far", 100, 400);
    expect(p.allocate("me", 103, 0)?.evicted).toBe("far");
    expect(PRIO_NEAR).toBeGreaterThan(0);
  });
  it("ADR-148: no live-page ping-pong in a near crowd (minimum residency + nearer-by-margin), the local player still wins", () => {
    const l = new PageLRU<string>(2, 90); l.allocate("a", 100, 9); l.allocate("b", 100, 10);
    // a just-paged-in live page is not taken by a slightly / clearly nearer character right away
    for (let f = 101; f < 100 + LIVE_MIN_RESIDENT_FRAMES; f++) { l.touch("a", f, 9); l.touch("b", f, 10); expect(l.allocate("c", f, 4)).toBeNull(); }
    // only clearly nearer (squared x1.5) after the residency: 8 vs 10 is not, 4 vs 10 is
    const f = 100 + LIVE_MIN_RESIDENT_FRAMES + 1; l.touch("a", f, 9); l.touch("b", f, 10);
    expect(l.allocate("c", f, 4)).toBeNull(); // ADR-188: both drawn this frame -> on screen, never stolen
    expect(l.allocate("c", f + 3, 8)).toBeNull();
    expect(l.allocate("c", f + 3, 4)?.evicted).toBe("b");
    const m = new PageLRU<string>(1, 90); m.allocate("x", 100, 5);
    expect(m.allocate("me", 101, 0)).toBeNull(); expect(m.allocate("me", 103, 0)?.evicted).toBe("x");
  });
});
