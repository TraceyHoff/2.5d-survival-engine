import { describe, expect, it } from "vitest";
import { resolveSprite, SPRITE_FALLBACKS, STATION_LIGHT_RADIUS, StationKind } from "../src/index.js";

describe("ADR-227 smaller campfire flames (superseded by real art, ADR-242)", () => {
  const OWN_ART = ["campfire", "torch_stand", "fireplace", "wood_stove", "lantern", "windsock", "mirror"];
  it("the hearth / light / decor pieces with real art no longer carry a sprite_fallbacks entry", () => {
    for (const k of OWN_ART) expect(SPRITE_FALLBACKS.sprites[k], k).toBeUndefined();
  });
  it("campfire draws its own art at full size (no bonfire x0.55 scaling)", () => {
    const has = (k: string): boolean => k === "bonfire" || k === "campfire";
    const camp = resolveSprite("campfire", has)!; expect(camp.key).toBe("campfire"); expect(camp.scale).toBe(1);
    expect(resolveSprite("bonfire", has)!.scale).toBe(1);
  });
  it("aliases that pointed at the pieces still resolve to the real art", () => {
    const has = (k: string): boolean => OWN_ART.includes(k);
    expect(resolveSprite("stove_iron", (k) => k === "wood_stove")?.key).toBe("wood_stove");
    expect(resolveSprite("lantern_hanging", has)?.key).toBe("lantern");
    expect(resolveSprite("mirror_wall", has)?.key).toBe("mirror");
  });
  it("light radius is unchanged (ADR-216)", () => { expect(STATION_LIGHT_RADIUS[StationKind.Campfire]).toBe(8); });
});
