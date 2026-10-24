import { describe, expect, it } from "vitest";
import { PageLRU, PRIO_NEAR } from "../src/gl/vram.js";

describe("wear pool distance priority", () => {
  it("a nearer request evicts the farthest live page even inside the protect window", () => {
    const lru = new PageLRU<string>(2, 90);
    lru.allocate("far1", 10, 400); lru.allocate("far2", 10, 900);
    expect(lru.canAllocate("me", 10)).toBe(false); // no priority: old behaviour, pool full of live pages
    const r = lru.allocate("me", 10, 0);
    expect(r?.evicted).toBe("far2");
    expect(lru.prioOf("me")).toBe(0);
  });
  it("a farther request never evicts a nearer page", () => {
    const lru = new PageLRU<string>(1, 90);
    lru.allocate("near", 5, PRIO_NEAR);
    expect(lru.allocate("far", 6, 1000)).toBeNull();
    lru.touch("near", 7, 4); expect(lru.prioOf("near")).toBe(4);
  });
});
