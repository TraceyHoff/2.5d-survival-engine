import { describe, expect, it } from "vitest";
import { offHandSpriteKeys, resolveOffHandSprite, offHandBehind, offHandAnchor, OFFHAND_BEHIND_FACINGS } from "../src/character/offhand.js";
import type { HandAnchor } from "../src/assets/atlasManager.js";
import { readFileSync } from "node:fs";

describe("ADR-135 off-hand", () => {
  it("looks up offhand_<key>, falling back to held_<key>, else nothing", () => {
    expect(offHandSpriteKeys("iron_knife")).toEqual(["offhand_iron_knife", "held_iron_knife"]);
    const ids = new Map([["offhand_iron_knife", 7], ["held_iron_knife", 3], ["held_torch", 9]]);
    const tryId = (k: string): number | undefined => ids.get(k);
    expect(resolveOffHandSprite("iron_knife", tryId)).toBe(7);
    expect(resolveOffHandSprite("torch", tryId)).toBe(9);
    expect(resolveOffHandSprite("rock", tryId)).toBeUndefined();
    expect(resolveOffHandSprite(undefined, tryId)).toBeUndefined();
  });
  it("Art shipped offhand_<knife> for all six knives (8 dirs, grip 0.5,0.25)", () => {
    const man = JSON.parse(readFileSync(new URL("../../assets/pack/items/manifest.items.json", import.meta.url), "utf8")) as { sprites: Array<{ key: string; anchor?: { x: number; y: number } }> };
    for (const m of ["stone", "bronze", "iron", "steel", "alloy", "bone"]) {
      const s = man.sprites.find((x) => x.key === `offhand_${m}_knife`); expect(s, m).toBeDefined(); expect(s!.anchor).toEqual({ x: 0.5, y: 0.25 });
    }
  });
  it("draw order per facing: behind the body only when facing away (NW, N, NE)", () => {
    const want = [false, false, false, false, true, true, true, false]; // 0=SE 1=S 2=SW 3=W 4=NW 5=N 6=NE 7=E
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((f) => offHandBehind(f))).toEqual(want);
    expect([...OFFHAND_BEHIND_FACINGS].sort()).toEqual([4, 5, 6]);
    expect(offHandBehind(1, true)).toBe(true); // Art's per-frame behind flag wins
    expect(offHandBehind(13)).toBe(true); // wraps (13 % 8 = 5 = N)
  });
  it("missing handL anchor: mirrors handR across the pivot, or skips; never throws", () => {
    const body = { ax: 32 };
    const handR: HandAnchor = { x: 40, y: 50, angle: 20, behind: true };
    const handL: HandAnchor = { x: 20, y: 48, angle: -5, behind: false };
    expect(offHandAnchor((_b, n) => (n === "handL" ? handL : handR), body)).toEqual({ anchor: handL, fallback: false });
    expect(offHandAnchor((_b, n) => (n === "handR" ? handR : undefined), body)).toEqual({ anchor: { x: 24, y: 50, angle: -20, behind: false }, fallback: true });
    expect(offHandAnchor(() => undefined, body)).toBeUndefined();
  });
});
