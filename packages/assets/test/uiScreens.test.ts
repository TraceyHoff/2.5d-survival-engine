import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UI_WIDGET_TYPES, validateUiScreen } from "../src/index.js";

const root = join(__dirname, "../../../assets");
const screenFiles = (): string[] => {
  const out: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== "mock") walk(p); } else if (e.name.endsWith(".json")) out.push(p); } };
  walk(join(root, "ui/screens")); walk(join(root, "stalls/ui/screens"));
  return out;
};

describe("ui screen widget schema", () => {
  it("includes the customization widgets", () => {
    expect(UI_WIDGET_TYPES).toContain("charpreview"); expect(UI_WIDGET_TYPES).toContain("cosmeticslot");
  });
  it("every authored screen validates", () => {
    const files = screenFiles(); expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(validateUiScreen(JSON.parse(readFileSync(f, "utf8")), f)).toEqual([]);
  });
  it("validates charpreview / cosmeticslot props", () => {
    const ok = { schema: "ui-screen/1", root: { type: "box", children: [
      { type: "charpreview", appearance: "{creator.appearance}", rotate: true, zoom: 1.5, anim: "walk" },
      { type: "cosmeticslot", slot: "hair", bodyType: "{creator.bodyType}", unlocked: "unlocked", paletteChannel: "primary" },
    ] } };
    expect(validateUiScreen(ok)).toEqual([]);
    const bad = { root: { type: "box", children: [
      { type: "charpreview", appearance: "creator", zoom: 0 }, { type: "cosmeticslot", slot: "cape", bodyType: "elf", unlocked: "x", paletteChannel: "tertiary" }, { type: "widgetx" },
    ] } };
    const issues = validateUiScreen(bad);
    for (const s of ["appearance must be a binding", "zoom must be", "slot must be", "bodyType must be", "unlocked must be", "paletteChannel must be", "unknown widget type"]) expect(issues.join("\n")).toContain(s);
  });
});
