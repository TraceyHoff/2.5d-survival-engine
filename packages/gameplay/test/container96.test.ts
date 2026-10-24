import { describe, expect, it } from "vitest";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

/** ADR-098: Container capacity is per-instance slotCount (from the def), arrays are CONTAINER_MAX_SLOTS wide. */
describe("per-instance Container capacity up to 96 slots", () => {
  it("fills exactly slotCount slots (non-stacking items), never past it, for 12/24/60/96", () => {
    const w = makeWorld(); const axe = G.gameplayDefs(w).itemId("stone_axe");
    for (const n of [12, 24, 60, 96]) {
      const e = w.create(); w.add(e, G.Container, { slotCount: n, maxWeight: 100000 });
      expect(G.addItem(w, e, axe, 200)).toBe(n);
      expect(G.countItem(w, e, axe)).toBe(n);
      expect(G.slotItem(w, e, n - 1).item).toBe(axe);
      if (n < 96) expect(G.slotItem(w, e, n).item).toBe(0);
    }
  });
  it("weight limit still binds before slots", () => {
    const w = makeWorld(); const axe = G.gameplayDefs(w).itemId("stone_axe");
    const e = w.create(); w.add(e, G.Container, { slotCount: 96, maxWeight: 10 });
    expect(G.addItem(w, e, axe, 96)).toBeLessThan(10);
  });
  it("piece defs may declare up to 96 slots", () => {
    expect(G.CONTAINER_MAX_SLOTS).toBe(96); expect(G.CONTAINER_LEGACY_SLOTS).toBe(24);
  });
});
