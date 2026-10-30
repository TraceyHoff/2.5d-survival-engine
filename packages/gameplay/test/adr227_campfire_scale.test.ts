import { describe, expect, it } from "vitest";
import { resolveSprite, STATION_LIGHT_RADIUS, StationKind } from "../src/index.js";

describe("ADR-227 smaller campfire flames", () => {
  const has = (k: string): boolean => k === "bonfire" || k === "furnace"; // the pack ships bonfire/furnace art, no campfire art
  it("campfire draws the bonfire art at 0.55; the bonfire keeps full size", () => {
    const camp = resolveSprite("campfire", has)!;
    expect(camp.key).toBe("bonfire"); expect(camp.scale).toBeCloseTo(0.55);
    expect(resolveSprite("bonfire", has)!.scale).toBe(1);
  });
  it("other bonfire-art fires stay in proportion (lantern < torch stand <= campfire-ish)", () => {
    const lantern = resolveSprite("lantern", has)!.scale, torch = resolveSprite("torch_stand", has)!.scale;
    expect(lantern).toBeLessThan(torch); expect(torch).toBeLessThanOrEqual(0.6);
    expect(resolveSprite("wood_stove", has)!.scale).toBeLessThan(1);
  });
  it("light radius is unchanged (ADR-216)", () => { expect(STATION_LIGHT_RADIUS[StationKind.Campfire]).toBe(8); });
});
