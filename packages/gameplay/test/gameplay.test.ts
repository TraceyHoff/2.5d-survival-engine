import { describe, it, expect } from "vitest";
import { World, TimeOfDay } from "@engine/core";
import { installGameplay } from "../src/index.js";
describe("gameplay stub", () => {
  it("advances time of day and wraps days", () => {
    const w = new World(); installGameplay(w, 10);
    for (let i = 0; i < 10; i++) w.step(0.05);
    expect(w.resource(TimeOfDay).day).toBe(1);
  });
});
