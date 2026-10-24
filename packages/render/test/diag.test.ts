import { describe, expect, it } from "vitest";
import { formatDiagReport, glErrorName, fboStatusName, isEmptyScene, newDiag, parseDiagFlag } from "../src/gl/diag.js";
import { parseGlFlags } from "../src/gl/capabilities.js";
import { MIN_ATLAS_DOWNSCALE } from "../src/assets/atlasManager.js";

describe("render diagnostics", () => {
  it("parses ?diag and ?gl=safe", () => {
    expect(parseDiagFlag("?diag=1")).toBe(true); expect(parseDiagFlag("?diag=0")).toBe(false); expect(parseDiagFlag("?x=1")).toBe(false); expect(parseDiagFlag(undefined)).toBe(false);
    expect(parseGlFlags("?gl=safe,mediump")).toEqual(["safe", "mediump"]);
  });
  it("detects an empty scene (all samples = clear colour)", () => {
    const clear: [number, number, number, number] = [90, 44, 40, 255];
    expect(isEmptyScene([[90, 44, 40, 255], [91, 45, 40, 255]], clear)).toBe(true);
    expect(isEmptyScene([[90, 44, 40, 255], [60, 160, 60, 255]], clear)).toBe(false);
    expect(isEmptyScene([], clear)).toBe(true);
  });
  it("names GL errors and FBO status", () => {
    expect(glErrorName(0)).toBe("NO_ERROR"); expect(glErrorName(0x505)).toBe("OUT_OF_MEMORY"); expect(fboStatusName(0x8cd5)).toBe("COMPLETE"); expect(fboStatusName(0x8cdd)).toBe("UNSUPPORTED");
  });
  it("formats a plain-text report", () => {
    const d = newDiag(true, false); d.fbo.scene = "COMPLETE"; d.passErrors.scene = "NO_ERROR";
    d.readbacks.push({ frame: 1, scene: [[90, 44, 40, 255]], light: [[128, 128, 128, 255]], output: [[90, 44, 40, 255]], clear: [90, 44, 40, 255], instances: 12, drawCalls: 5, empty: true });
    const r = formatDiagReport(d, { renderer: "Mali", mobile: true, precision: "highp", budgetMB: 256, vramMB: 107, fallbacks: [], problems: [] });
    expect(r).toContain("SCENE EMPTY"); expect(r).toContain("scene=COMPLETE"); expect(r).toContain("#5a2c28");
  });
  it("allows a budget downscale below x0.25", () => { expect(MIN_ATLAS_DOWNSCALE).toBe(0.125); });
});
