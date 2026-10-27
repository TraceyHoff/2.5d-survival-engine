import { describe, it, expect } from "vitest";
import { hitPose } from "../src/view.js";
describe("ADR-193 undirected hits", () => {
  it("no knockback / tilt / squash without an attacker, only a faint sizzle; directed hits unchanged", () => {
    for (const ms of [0, 40, 60, 100, 200]) { const p = hitPose(ms, 0, false); if (p) { expect(p.dx).toBe(0); expect(p.dy).toBe(0); expect(p.tilt).toBe(0); expect(p.scale).toBe(1); expect(p.flash).toBeLessThanOrEqual(0.5); } }
    expect(hitPose(60, 0)!.dx).toBeGreaterThan(0.05);
  });
});
