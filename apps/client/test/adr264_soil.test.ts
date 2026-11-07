import { describe, expect, it } from "vitest";
import { TerrainCmd, CraftCmd } from "@engine/gameplay";
import { terrainRejectText } from "../src/terrain-reject.js";
describe("ADR-264 shovel rejection toasts", () => {
  it("explains missing soil and full inventory only for shovel commands", () => {
    expect(terrainRejectText(TerrainCmd, "no_soil")).toBe("Need soil to raise ground");
    expect(terrainRejectText(TerrainCmd, "inventory_full")).toBe("Inventory full — no room for soil");
    expect(terrainRejectText(CraftCmd, "no_soil")).toBeUndefined();
  });
});
