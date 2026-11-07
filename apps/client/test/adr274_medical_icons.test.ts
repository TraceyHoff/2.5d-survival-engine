import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconKeysFromCss } from "../src/gameplay-panels.js";
import { ICON_DATA } from "../src/game-icons-data.js";
import { diseaseIcon, iconForItem, defaultDefs } from "@engine/gameplay";

const css = readFileSync(new URL("../src/gameplay-panels.css", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../../../packages/assets/pack/nature/manifest.nature.json", import.meta.url), "utf8"));
const ui = JSON.parse(readFileSync(new URL("../../../assets/ui/atlas/ui_atlas.json", import.meta.url), "utf8"));
describe("ADR-274 dedicated Art & Assets medical art", () => {
  it("uses Art's dedicated splint frame, never a bandage or shirt alias", () => {
    const s = manifest.sprites.find((s: {key: string}) => s.key === "leg_splint");
    expect(s.atlas).toBe("nature_icons"); expect(s.animations.idle.frames).toEqual([123]);
    for (const other of manifest.sprites) if (other.key !== "leg_splint" && other.atlas === "nature_icons") expect(other.animations.idle.frames).not.toContain(123);
  });
  it("uses the dedicated UI-atlas status key, not a duplicated embedded icon", () => {
    expect(diseaseIcon("broken_leg")).toBe("broken_leg");
    expect(ui.frames.broken_leg.frame).toEqual({ x: 696, y: 62, w: 32, h: 32 });
    expect(ICON_DATA["broken_leg"]).toBeUndefined(); expect(ICON_DATA["broken_leg.png"]).toBeUndefined();
  });
  it("has generated CSS for the splint and no crafting category fallback", () => {
    const icons = iconKeysFromCss([css]); expect(icons.has("leg_splint")).toBe(true);
    const d = defaultDefs(); expect(iconForItem(d.items.get(d.itemId("leg_splint"))!, key => icons.has(key))).toBe("leg_splint");
  });
});
