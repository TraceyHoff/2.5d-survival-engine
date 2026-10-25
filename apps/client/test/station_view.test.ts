import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { animFrameId } from "@engine/render";
import { isFreeStandingStation, stationFireFrame } from "../src/station-view.js";

describe("station view (ADR-141)", () => {
  it("only stations without a BuildPiece use the bonfire sprite; placed workbench/anvil keep their piece art", () => {
    expect(isFreeStandingStation(true, false)).toBe(true);
    expect(isFreeStandingStation(true, true)).toBe(false);
    expect(isFreeStandingStation(false, true)).toBe(false);
  });
  it("view.ts routes the bonfire branch through the check", () => {
    expect(readFileSync("apps/client/src/view.ts", "utf8")).toMatch(/isFreeStandingStation\(net\.has\(e, CraftingStation\), net\.has\(e, GPiece\)\)/);
  });
  it("an out (unlit) station shows the unlit art, a lit one the burning loop", () => {
    const names = ["idle", "unlit"];
    expect(stationFireFrame(names, true)).toBe(0);
    expect(stationFireFrame(names, false)).toBe(animFrameId(1));
    expect(stationFireFrame(["idle"], false)).toBe(0);
  });
});
