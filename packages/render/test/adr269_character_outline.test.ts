// ADR-269: characters get their own darker union silhouette outline even though the global sprite outline stays off.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHARACTER_OUTLINE } from "../src/sprites.js";
import { DEFAULT_STYLE } from "../src/style.js";

const src = readFileSync(fileURLToPath(new URL("../src/sprites.ts", import.meta.url)), "utf8");
describe("ADR-269 character outline", () => {
  it("is on by default: 1 texel, dark (luma < 0.1), mostly opaque; the world outline stays off", () => {
    expect(DEFAULT_STYLE.outline.enabled).toBe(false);
    expect(CHARACTER_OUTLINE.widthPx).toBe(1);
    const [r, g, b, a] = CHARACTER_OUTLINE.color; expect(0.299 * r + 0.587 * g + 0.114 * b).toBeLessThan(0.1); expect(a).toBeGreaterThanOrEqual(0.6); expect(a).toBeLessThan(1);
  });
  it("the outline-only character pass uses the character outline when the global one is off, and the pass is enabled by it", () => {
    expect(src).toContain("float ow2 = gOut ? uOutline : uCharOutline;");
    expect(src).toContain("(cx.style.outline.enabled || this.characterOpts.outlineWidthPx > 0) && this.characterOpts.outline === \"union\"");
    expect(src).toMatch(/uniform1f\(u\.uCharOutline \?\? null, this\.characterOpts\.outlineWidthPx\)/);
    // world sprites still outline only via the global uOutline (main pass unchanged)
    expect(src).toContain("if (a < 0.5 && uOutline > 0.0 && (vFlags & 16) == 0) {");
  });
});
