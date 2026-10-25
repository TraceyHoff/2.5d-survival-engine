import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isFreeStandingStation } from "../src/station-view.js";

describe("station view (ADR-141)", () => {
  it("only stations without a BuildPiece use the bonfire sprite; placed workbench/anvil keep their piece art", () => {
    expect(isFreeStandingStation(true, false)).toBe(true);
    expect(isFreeStandingStation(true, true)).toBe(false);
    expect(isFreeStandingStation(false, true)).toBe(false);
  });
  it("view.ts routes the bonfire branch through the check", () => {
    expect(readFileSync("apps/client/src/view.ts", "utf8")).toMatch(/isFreeStandingStation\(net\.has\(e, CraftingStation\), net\.has\(e, GPiece\)\)/);
  });
});
