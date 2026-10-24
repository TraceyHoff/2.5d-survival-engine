import { describe, it, expect } from "vitest";
import { PageLRU, PRIO_NEAR } from "../src/gl/vram.js";

describe("ADR-123: visible characters' wear/face pages are pinned", () => {
  it("a farther-than-near request cannot steal a live retained page (no dressed<->body flicker between crowds)", () => {
    const l = new PageLRU<string>(1, 90); l.retain("wearA"); l.allocate("wearA", 100, 400);
    expect(l.allocate("wearB", 101, 100)).toBeNull();
    expect(l.has("wearA")).toBe(true);
  });
  it("an unretained live page is still taken by a nearer request; the local player / near characters may take pinned pages", () => {
    const l = new PageLRU<string>(1, 90); l.allocate("a", 100, 400);
    expect(l.allocate("b", 101, 100)?.evicted).toBe("a");
    const p = new PageLRU<string>(1, 90); p.retain("far"); p.allocate("far", 100, 400);
    expect(p.allocate("me", 101, 0)?.evicted).toBe("far");
    expect(PRIO_NEAR).toBeGreaterThan(0);
  });
});
