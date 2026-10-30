// ADR-233: the auto-focused header close button's tooltip must not pop (clipped) above the panel on touch devices.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const css = readFileSync(resolve(__dirname, "../src/gameplay-panels.css"), "utf8");

test("header tooltips open below, inside the panel", () => {
  expect(css).toMatch(/\.gm-panel header \[data-tip\]:not\(\[data-tip=""\]\)::before\{bottom:auto;top:calc\(100% \+ 6px\)/);
});

test("touch: focus alone (modal auto-focus) does not show the header close tip", () => {
  expect(css).toMatch(/@media \(hover:none\),\(pointer:coarse\)\{\.gm-modal \.gm-panel header \[data-tip\]:not\(\[data-tip=""\]\):focus:not\(:active\)::before\{opacity:0;visibility:hidden\}\}/);
});
