import { describe, expect, it } from "vitest";
import { AtlasManager, STREAM_FLOOR_SLOTS, VISIBLE_PIN_RE, WEAR_BUDGET_SHARE, WEAR_FLOOR_SLOTS } from "../src/assets/atlasManager.js";

/** ADR-251: pool rebalancing (furniture / vehicles / ground stay full res inside the VRAM budget) + slot bleed. */
function am(budget: number): any {
  const gl = { canvas: undefined, getParameter: () => 4096, isContextLost: () => false, getError: () => 0 } as never;
  const a = new AtlasManager(gl, { registerLoader: () => {} } as never, { textureBudgetMB: budget }) as any;
  a.atlases = []; a.coldDownscale = 1; a.downscale = 1; a.layerSize = 2048; a.layers = 4; a.planLayers = 4; a.packedLayers = 4; a.pools = [];
  return a;
}
const page = (key: string, w: number, h: number, pool = 1) => ({ key, source: {}, count: 1, lazy: { w1: w, h1: h, state: 0, pool } });
const mb = (a: any) => {
  const per = a.layerBytes([]), pper = a.poolLayerBytes([]);
  return (a.layers - a.pools.reduce((t: number, p: any) => t + p.layers, 0)) * per / 1048576
    + a.pools.reduce((t: number, p: any) => t + p.layers * (p.cls === "wear" || p.cls === "body" ? per : pper), 0) / 1048576;
};

describe("ADR-251: atlas pool rebalancing", () => {
  it("furniture and ground-tile atlases are pinned at full res (fitBudget), creature/ui atlases are not", () => {
    for (const k of ["furniture", "furniture_beds", "gt_summer_p0", "gt_winter_p1"]) expect(VISIBLE_PIN_RE.test(k)).toBe(true);
    for (const k of ["furniturex", "zombies", "ui_icons", "decor"]) expect(VISIBLE_PIN_RE.test(k)).toBe(false);
  });
  it("a 1024 power-of-two page tiles a 2048 layer 2x2 (no gap); odd sizes keep the POOL_GAP gutter", () => {
    const a = am(1024);
    expect(a.poolGeom([page("s", 1024, 1024)], 1).perLayer).toBe(4);
    expect(a.poolGeom([page("s", 1020, 1020)], 1).perLayer).toBe(4);
    expect(a.poolGeom([page("s", 1000, 600)], 1).pw).toBeGreaterThan(1000);
  });
  for (const budget of [1024, 448]) it(`wear is capped at ${WEAR_BUDGET_SHARE * 100}% of a ${budget} MB budget and leaves room for the visible pools`, () => {
    const a = am(budget);
    const wear = Array.from({ length: 400 }, (_, i) => page("cz_w" + i, 1024, 1024, 3));
    const hold = a.poolReserveBytes([page("veh_a", 2048, 2048, 1)], 4, [], 1);
    a.planPool(wear, 200, [], "wear", false, 1, hold);
    const w = a.pools[0]; expect(w.k).toBe(1);
    expect(w.lru.capacity).toBeGreaterThanOrEqual(WEAR_FLOOR_SLOTS);
    expect(w.layers * a.layerBytes([]) / 1048576).toBeLessThanOrEqual(budget * WEAR_BUDGET_SHARE + a.layerBytes([]) / 1048576);
    a.planPool(Array.from({ length: 60 }, (_, i) => page("decor_furn_" + i, 1024, 1024)), 24, [], "stream", true);
    const s = a.pools[1]; expect(s.k).toBe(1); expect(s.lru.capacity).toBeGreaterThanOrEqual(STREAM_FLOOR_SLOTS);
    expect(mb(a)).toBeLessThanOrEqual(budget);
  });
  it("the sprite shader clamps atlas taps inside the frame rect (no neighbouring-slot bleed)", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../src/sprites.ts", import.meta.url), "utf8");
    expect(src).toContain("vec2 rectClamp(vec2 uv, int l, vec2 fw)");
    expect(src).toContain("vec3 su = inUv(uv, cw)");
    expect(src).not.toMatch(/texture\(uTintM, uv\)/);
  });
});
