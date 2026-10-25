import { describe, it, expect } from "vitest";
import { connectOverlayVisible } from "../src/connect.js";
describe("ADR-142 connect overlay leaves the HUD once connected", () => {
  it("hidden only while connected", () => {
    expect(connectOverlayVisible("connected")).toBe(false);
    for (const s of ["idle", "connecting", "disconnected"]) expect(connectOverlayVisible(s)).toBe(true);
  });
});
