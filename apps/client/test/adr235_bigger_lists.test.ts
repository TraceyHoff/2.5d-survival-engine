// ADR-235: list modals (build, crafting, inventory, container) size their grids from the viewport, not fixed px caps.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const css = readFileSync(resolve(__dirname, "../src/gameplay-panels.css"), "utf8");
const block = css.slice(css.indexOf("/* ADR-235"));

test("ADR-235 block is last so it overrides the earlier fixed caps", () => {
  expect(css.indexOf("/* ADR-235")).toBeGreaterThan(css.lastIndexOf("[data-role=piece-grid]{grid-template-columns:repeat(auto-fill,minmax(100px"));
});

test("wider panels for build, crafting, inventory and container", () => {
  expect(block).toContain(":has([data-role=build-cats]){width:min(1120px,96vw)");
  expect(block).toContain(":has([data-role=recipe-grid]){width:min(1000px,96vw)");
  expect(block).toContain(":has([data-role=inv-layout]){max-width:min(960px,96vw)}");
  expect(block).toContain(":has([data-role=inv-layout][data-mode=container]){max-width:min(1200px,96vw)}");
});

test("grid heights follow the viewport (dvh minus chrome) with a floor, so panels never overflow", () => {
  for (const g of ["piece-grid", "recipe-grid", "inv-grid", "container-grid"]) expect(block).toMatch(new RegExp(`\\[data-role=${g}\\][^{]*\\{[^}]*max-height:max\\(\\d+px,(min\\()?calc\\(100dvh - \\d+px\\)`));
});

test("phones get 4 build/recipe columns with tiles at or above 76px", () => {
  expect(block).toMatch(/@media \(max-width:620px\)\{[\s\S]*piece-grid\]\{grid-template-columns:repeat\(auto-fill,minmax\(76px,1fr\)\)/);
  expect(block).toMatch(/recipe-grid\]\{grid-template-columns:repeat\(auto-fill,76px\)/);
});
