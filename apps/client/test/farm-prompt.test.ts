import { describe, expect, it } from "vitest";
import { controlLabel, promptText, quickUseFires } from "../src/farm-prompt.js";

describe("farm context prompt (ADR-110)", () => {
  it("labels bindings per device and keeps Harvest on Interact", () => {
    expect(controlLabel("key.KeyX")).toBe("X"); expect(controlLabel("pad.b")).toBe("B"); expect(controlLabel("mouse.left")).toBe("LMB"); expect(controlLabel(undefined)).toBe("");
    const p = { action: "Till" as const, slot: 0, fail: 0, label: "Till" };
    expect(promptText(p, "X", "keyboardMouse")).toBe("[X] Till"); expect(promptText(p, "B", "gamepad")).toBe("[B] Till"); expect(promptText(p, "X", "touch")).toBe("Till");
    expect(quickUseFires(p)).toBe(true); expect(quickUseFires({ ...p, action: "Harvest" })).toBe(false); expect(quickUseFires(undefined)).toBe(false);
  });
});
