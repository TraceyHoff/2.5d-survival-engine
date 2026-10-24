import { describe, expect, it } from "vitest";
import { BuildingTierStreamer } from "../src/assets/buildingTiers.js";
import { isStreamedBuildingAtlas } from "../src/assets/atlasManager.js";

function fakePages() {
  const refs = new Map<string, number>(); const log: string[] = [];
  const atlasOf = (id: number): string | null => (id >= 100 && id < 500 ? `building_t${Math.floor(id / 100)}` : null);
  return { refs, log, pages: {
    streamClass: (id: number) => (atlasOf(id) ? "bld" : null), pageKey: atlasOf,
    retainSprite: (id: number) => { const k = atlasOf(id)!; refs.set(k, (refs.get(k) ?? 0) + 1); log.push("+" + k); },
    releaseSprite: (id: number) => { const k = atlasOf(id)!; refs.set(k, (refs.get(k) ?? 0) - 1); log.push("-" + k); },
  } };
}
const frame = (s: BuildingTierStreamer, ids: number[]) => { s.begin(); for (const id of ids) s.add(id); s.end(); };

describe("building tier streaming", () => {
  it("matches only file-backed building_t<N> atlases", () => {
    expect(isStreamedBuildingAtlas("building_t3", "/art/pack/building/atlases/building_t3.png")).toBe(true);
    expect(isStreamedBuildingAtlas("building_t3", "blob:x")).toBe(false);
    expect(isStreamedBuildingAtlas("buildings_stone", "/x.png")).toBe(false);
  });
  it("retains a tier once while any nearby piece uses it and releases it when none do", () => {
    const f = fakePages(); const s = new BuildingTierStreamer(f.pages);
    frame(s, [101, 102, 103, 7, 8]); // three t1 pieces + non-tier sprites
    expect(s.heldKeys()).toEqual(["building_t1"]); expect(f.refs.get("building_t1")).toBe(1);
    frame(s, [101, 205, 206]); // t2 comes into range
    expect(s.heldKeys()).toEqual(["building_t1", "building_t2"]);
    frame(s, [101, 205, 206]); // steady state: no churn
    expect(f.log).toEqual(["+building_t1", "+building_t2"]);
    frame(s, [205]); // t1 out of range
    expect(s.heldKeys()).toEqual(["building_t2"]); expect(f.refs.get("building_t1")).toBe(0);
    frame(s, []);
    expect(s.heldKeys()).toEqual([]); expect([...f.refs.values()].every((n) => n === 0)).toBe(true);
    expect(f.pages.retainSprite).toBeDefined(); expect(s.retains).toBe(2); expect(s.releases).toBe(2);
  });
  it("never loads tiers that are absent (t3/t4 untouched)", () => {
    const f = fakePages(); const s = new BuildingTierStreamer(f.pages);
    frame(s, [101, 201]); frame(s, [101, 201]);
    expect(f.refs.has("building_t3")).toBe(false); expect(f.refs.has("building_t4")).toBe(false);
  });
});
