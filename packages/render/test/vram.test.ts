import { AnimState, ANIM_STATE_NAMES } from "@engine/core";
import { describe, expect, it } from "vitest";
import { PageLRU, VramAccountant, rgbaBytes } from "../src/gl/vram.js";
import { STATE_ANIMS, AnimStateId } from "../src/assets/atlasManager.js";

describe("rgbaBytes", () => {
  it("counts the mip chain as 4/3", () => {
    expect(rgbaBytes(1024, 1024, false)).toBe(4 * 1048576);
    expect(rgbaBytes(1024, 1024, true)).toBeCloseTo(4 * 1048576 * 4 / 3);
  });
});

describe("VramAccountant", () => {
  it("tracks resident, reserved pool and streamed bytes against the budget", () => {
    const v = new VramAccountant(160 * 1048576);
    v.setResident(100 * 1048576, 40 * 1048576); v.pageSlots = 8;
    expect(v.withinBudget).toBe(true); expect(v.headroomBytes).toBe(20 * 1048576);
    v.pageIn(5 * 1048576); v.pageIn(5 * 1048576);
    expect(v.stats()).toMatchObject({ budgetMB: 160, residentMB: 100, reservedMB: 40, streamedMB: 10, totalMB: 140, pagesResident: 2, pageIns: 2, evictions: 0, pageSlots: 8 });
    v.evict(5 * 1048576);
    expect(v.stats()).toMatchObject({ streamedMB: 5, pagesResident: 1, evictions: 1 });
    v.setResident(150 * 1048576, 20 * 1048576);
    expect(v.withinBudget).toBe(false); expect(v.headroomBytes).toBe(0);
    expect(v.stats().pagesResident).toBe(0); // rebuild drops streamed pages
  });
  it("never goes negative", () => {
    const v = new VramAccountant(1); v.evict(100); expect(v.streamedBytes).toBe(0); expect(v.pagesResident).toBe(0);
  });
});

describe("PageLRU", () => {
  it("fills free slots before evicting", () => {
    const l = new PageLRU(2);
    expect(l.allocate("a", 1)).toEqual({ slot: 0 }); expect(l.allocate("b", 1)).toEqual({ slot: 1 });
    expect(l.allocate("a", 2)).toEqual({ slot: 0 }); // already resident: touch only
    expect(l.size).toBe(2);
  });
  it("evicts the least recently used page", () => {
    const l = new PageLRU(2); l.allocate("a", 1); l.allocate("b", 2); l.touch("a", 3);
    expect(l.allocate("c", 4)).toEqual({ slot: 1, evicted: "b" });
    expect(l.has("b")).toBe(false); expect(l.slotOf("c")).toBe(1);
  });
  it("evicts unreferenced pages before referenced ones, regardless of age", () => {
    const l = new PageLRU(2); l.allocate("old", 1); l.allocate("new", 5);
    l.retain("old");
    expect(l.allocate("x", 6)?.evicted).toBe("new");
    l.release("old"); expect(l.refCount("old")).toBe(0);
    expect(l.allocate("y", 7)?.evicted).toBe("old");
  });
  it("never evicts pages used in the current frame", () => {
    const l = new PageLRU(1); l.allocate("a", 3);
    expect(l.allocate("b", 3)).toBeNull(); expect(l.has("a")).toBe(true);
    expect(l.allocate("b", 4)?.evicted).toBe("a");
  });
  it("protects recently used pages and reports whether a slot can be found", () => {
    const l = new PageLRU(1, 30); l.allocate("a", 10);
    expect(l.canAllocate("b", 20)).toBe(false); expect(l.allocate("b", 20)).toBeNull();
    expect(l.canAllocate("a", 20)).toBe(true);
    expect(l.allocate("b", 41)?.evicted).toBe("a");
  });
  it("keeps refcounts across eviction and reuses removed slots", () => {
    const l = new PageLRU(1); l.retain("a"); l.retain("a"); l.allocate("a", 1);
    l.allocate("b", 2); expect(l.has("a")).toBe(false); expect(l.refCount("a")).toBe(2);
    l.remove("b"); expect(l.allocate("a", 3)).toEqual({ slot: 0 }); expect(l.refCount("a")).toBe(2);
  });
});

describe("animal anim states", () => {
  it("maps eat/graze to manifest names with idle fallback", () => {
    expect(STATE_ANIMS[AnimStateId.Eat]).toEqual(["eat", "graze", "idle"]);
    expect(STATE_ANIMS[AnimStateId.Graze]).toEqual(["graze", "eat", "idle"]);
  });
  it("STATE_ANIMS follows core AnimState (ADR-093)", () => {
    expect(STATE_ANIMS.length).toBe(ANIM_STATE_NAMES.length);
    expect([AnimStateId.Eat, AnimStateId.Graze, AnimStateId.Shamble, AnimStateId.Crawl, AnimStateId.Feed]).toEqual([AnimState.Eat, AnimState.Graze, 10, 11, 12]);
    expect(STATE_ANIMS[AnimState.Gather]).toEqual(["gather", "idle"]);
    expect(STATE_ANIMS[AnimState.Build]).toEqual(["build", "idle"]);
    expect(STATE_ANIMS[AnimState.Crawl]![0]).toBe("crawl");
    expect(STATE_ANIMS[AnimState.Feed]![0]).toBe("feed");
  });
});
