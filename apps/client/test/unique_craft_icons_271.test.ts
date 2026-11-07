import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconKeysFromCss } from "../src/gameplay-panels.js";
import { iconForItem, gameplayDefs, installGameplay } from "@engine/gameplay";
import { World } from "@engine/core";

const css = readFileSync(new URL("../src/gameplay-panels.css", import.meta.url), "utf8");
const keys = iconKeysFromCss([css]);
const pos = (k: string) => new RegExp(`\\[data-icon="${k}"\\]\\{--cz-ipos:([^}]+)\\}`).exec(css)?.[1];

describe("crafting menu: cloth mask and paint brush have their own icons (no t-shirt / axe fallback)", () => {
  it("both keys are in the generated icon CSS with a unique cell", () => {
    for (const k of ["cloth_mask", "paint_brush"]) expect(keys.has(k), k).toBe(true);
    expect(pos("cloth_mask")).not.toBe(pos("linen_shirt"));
    expect(pos("paint_brush")).not.toBe(pos("stone_axe"));
  });
  it("iconForItem resolves to the item itself, not its category fallback", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); installGameplay(w, {}); const d = gameplayDefs(w);
    for (const k of ["cloth_mask", "paint_brush"]) { const it = [...d.items.values()].find((i) => i.key === k)!; expect(iconForItem(it, (x) => keys.has(x))).toBe(k); }
  });
});
