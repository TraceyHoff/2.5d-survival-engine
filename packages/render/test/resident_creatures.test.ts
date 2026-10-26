import { describe, it, expect } from "vitest";
import { AtlasManager, RESIDENT_CREATURE_RE, RESIDENT_CREATURE_MIN_MB } from "../src/assets/atlasManager.js";

const gl = { canvas: new EventTarget(), getParameter: () => 4096, isContextLost: () => false, getError: () => 0, NO_ERROR: 0, deleteTexture: () => {} } as never;
const mk = (mb: number) => new AtlasManager(gl, { registerLoader: () => {} } as never, { textureBudgetMB: mb }) as any;

describe("ADR-156 resident creature sheets", () => {
  it("creature sheets are resident only on budgets that hold them", () => {
    expect(mk(RESIDENT_CREATURE_MIN_MB).residentCreatures).toBe(true);
    expect(mk(768).residentCreatures).toBe(true);
    expect(mk(160).residentCreatures).toBe(false);
    expect(RESIDENT_CREATURE_RE.test("pets_cat_tabby")).toBe(true);
    expect(RESIDENT_CREATURE_RE.test("nature_critters_a_24x40")).toBe(true);
    expect(RESIDENT_CREATURE_RE.test("cz_wr_top_puffer")).toBe(false);
  });
});
