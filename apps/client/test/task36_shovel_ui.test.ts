// ADR-263 (Task 36): shovel target per device + underground darkness easing.
import { describe, expect, it } from "vitest";
import { shovelPrompt, shovelTarget } from "../src/world-tools.js";
import { easeUnderground, undergroundTarget } from "../src/underground.js";

describe("ADR-263 shovel controls", () => {
  const body = { x: 10.5, y: 10.5, facing: 0 }; // facing +x
  it("keyboard/mouse digs the hovered tile within reach, else the faced tile; touch / gamepad use the faced tile", () => {
    expect(shovelTarget("keyboardMouse", body, { x: 12, y: 9 })).toEqual({ x: 12, y: 9 });
    expect(shovelTarget("keyboardMouse", body, { x: 20, y: 20 })).toEqual({ x: 11, y: 10 });
    expect(shovelTarget("touch", body, { x: 12, y: 9 })).toEqual({ x: 11, y: 10 });
    expect(shovelTarget("gamepad", { ...body, facing: Math.PI / 2 }, undefined)).toEqual({ x: 10, y: 11 });
  });
  it("prompts name the controls per device", () => {
    expect(shovelPrompt("keyboardMouse")).toMatch(/Y raise.*H dig/);
    expect(shovelPrompt("gamepad")).toMatch(/LT \+ D-pad ↑ raise/);
    expect(shovelPrompt("touch")).toMatch(/Raise.*Dig/);
  });
  it("darkness target: none on the surface, a little in shallow pits, full from 3 levels down; eased", () => {
    expect(undergroundTarget(0)).toBe(0); expect(undergroundTarget(2)).toBeCloseTo(0.3); expect(undergroundTarget(3)).toBe(1); expect(undergroundTarget(25)).toBe(1);
    let u = 0; for (let i = 0; i < 60; i++) u = easeUnderground(u, 1, 1 / 60); expect(u).toBeGreaterThan(0.99);
    expect(easeUnderground(0.5, 0, 0)).toBe(0.5);
  });
});
