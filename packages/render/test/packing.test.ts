import { describe, it, expect } from "vitest";
import { AtlasManager } from "../src/assets/atlasManager.js";

/** Resident-array packing: MaxRects placement (fewer layers), budget planning still charged at the shelf count. */
function mgr(S = 1024) {
  const gl = { canvas: undefined, getParameter: () => 4096, isContextLost: () => false } as never;
  const am = new AtlasManager(gl, { registerLoader: () => {} } as never, { layerSize: S, textureBudgetMB: 160 }) as any;
  return am;
}
function rnd(seed: number) { let s = seed; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
const atl = (id: number, w: number, h: number) => ({ key: `a${id}`, id, img: { width: w, height: h }, count: 1, masks: {}, layer: 0, px: 0, py: 0 });

describe("resident atlas packing", () => {
  for (const seed of [1, 2, 3, 7, 42]) it(`seed ${seed}: no overlap, in bounds, 4px aligned (side arrays exact), never more layers than the shelf packer`, () => {
    const am = mgr(); const r = rnd(seed); const S = am.layerSize;
    const list = Array.from({ length: 60 }, (_, i) => atl(i, 16 + Math.floor(r() * 700), 16 + Math.floor(r() * 500)));
    am.pack(list);
    for (const a of list) { expect(a.px % 4).toBe(0); expect(a.py % 4).toBe(0); expect(a.px + a.img.width).toBeLessThanOrEqual(S); expect(a.py + a.img.height).toBeLessThanOrEqual(S); expect(a.layer).toBeLessThan(am.layers); }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!; if (a.layer !== b.layer) continue;
      const sep = a.px + a.img.width + 2 <= b.px || b.px + b.img.width + 2 <= a.px || a.py + a.img.height + 2 <= b.py || b.py + b.img.height + 2 <= a.py;
      expect(sep, `${a.key} vs ${b.key}`).toBe(true); // 2px gutter (no mip bleed)
    }
    const shelf = am.shelfLayers(list); expect(am.layers).toBeLessThanOrEqual(shelf); expect(am.planLayers).toBe(shelf);
  });
  it("frame bases follow list order (frame table unchanged by placement)", () => {
    const am = mgr(); const list = [atl(0, 300, 200), atl(1, 900, 900), atl(2, 50, 50)]; list[1]!.count = 5;
    am.pack(list); expect(list.map((a) => (a as { base?: number }).base)).toEqual([0, 1, 6]); expect(am.totalFrames).toBe(7);
  });
  it("planner charges the shelf count: freed layers are not refilled by planPool", () => {
    const am = mgr(); const list = Array.from({ length: 12 }, (_, i) => atl(i, 600, 300 + (i % 3) * 100));
    am.pack(list); expect(am.planLayers).toBeGreaterThanOrEqual(am.layers);
    expect(am.planEstimate(list)).toBeGreaterThanOrEqual(am.estimate(list));
  });
});
