import { describe, it, expect } from "vitest";
import { chooseRenderer } from "../src/canvas2d.js";

const probe = (ok: { webgl2?: boolean; "2d"?: boolean; throws?: boolean }) => (k: "webgl2" | "2d"): unknown => { if (ok.throws && k === "webgl2") throw new Error("blocked"); return ok[k] ? {} : null; };

describe("chooseRenderer", () => {
  it("picks WebGL2 when a fresh context is available", () => { expect(chooseRenderer(probe({ webgl2: true, "2d": true }))).toBe("webgl2"); });
  it("falls back to Canvas2D sprites when WebGL2 creation fails (Xbox Edge after GPU reset)", () => { expect(chooseRenderer(probe({ webgl2: false, "2d": true }))).toBe("canvas2d"); });
  it("treats a throwing getContext as failure", () => { expect(chooseRenderer(probe({ throws: true, "2d": true }))).toBe("canvas2d"); });
  it("debug dots only when nothing else works or forced", () => {
    expect(chooseRenderer(probe({}))).toBe("debug");
    expect(chooseRenderer(probe({ webgl2: true, "2d": true }), { forceDebug: true })).toBe("debug");
  });
  it("?renderer=canvas forces Canvas2D", () => { expect(chooseRenderer(probe({ webgl2: true, "2d": true }), { forceCanvas: true })).toBe("canvas2d"); });
});
