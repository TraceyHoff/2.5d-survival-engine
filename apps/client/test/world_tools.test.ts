import { describe, it, expect } from "vitest";
import { HordePhase } from "@engine/gameplay";
import { hordeCue, isoToCss } from "../src/world-tools.js";

describe("world tools (ADR-119..121)", () => {
  it("horde cue state machine: warning -> active -> defeated, new warning per seq", () => {
    const I = HordePhase.Idle, W = HordePhase.Warning, A = HordePhase.Active;
    expect(hordeCue(undefined, { phase: W, seq: 1 })).toBeUndefined();
    expect(hordeCue({ phase: I, seq: 0 }, { phase: W, seq: 1 })).toBe("warning");
    expect(hordeCue({ phase: W, seq: 1 }, { phase: W, seq: 1 })).toBeUndefined();
    expect(hordeCue({ phase: W, seq: 1 }, { phase: A, seq: 1 })).toBe("active");
    expect(hordeCue({ phase: A, seq: 1 }, { phase: I, seq: 1 })).toBe("defeated");
    expect(hordeCue({ phase: A, seq: 1 }, { phase: W, seq: 2 })).toBe("warning");
  });
  it("isoToCss centres the camera target", () => {
    const cam = { x: 0, y: 0, viewW: 800, viewH: 600, dpr: 1, drawZoom: 1, cssToWorld: () => ({ x: 0, y: 0 }) };
    expect(isoToCss(cam, 0, 0)).toEqual({ x: 400, y: 300 });
  });
});

describe("ADR-133 mode-gated Road / Sign buttons", async () => {
  const { worldToolBarState } = await import("../src/world-tools.js");
  it("nothing shows outside road mode unless a sign is in reach", () => {
    expect(worldToolBarState({ active: false, nearSign: false, hidden: false })).toEqual({ bar: false, road: false, sign: false });
    expect(worldToolBarState({ active: true, nearSign: false, hidden: false })).toEqual({ bar: true, road: true, sign: true });
    expect(worldToolBarState({ active: false, nearSign: true, hidden: false })).toEqual({ bar: true, road: false, sign: true });
    expect(worldToolBarState({ active: true, nearSign: true, hidden: true })).toEqual({ bar: false, road: false, sign: false });
  });
});
