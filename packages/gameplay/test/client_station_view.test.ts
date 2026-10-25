// ADR-141: on a client replica (no postSim systems) the station panel must still see the station the player stands at.
import { describe, expect, it } from "vitest";
import { Transform } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

describe("client craftingView station range", () => {
  it("a replicated workbench next to the player un-greys its recipes (no 'no_station')", () => {
    const w = makeWorld({ role: "client" }); const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0 });
    const before = G.craftingView({ world: w, player: p }, 2); expect(before.recipes.every((r) => r.reason === "no_station")).toBe(true);
    const st = w.create(); w.add(st, Transform, { x: 1, y: 0 }).add(st, G.CraftingStation, { kind: 2 }); // replicated: raw adds, no indexEntity, no postSim tick
    const v = G.craftingView({ world: w, player: p }, 2);
    expect(v.recipes.some((r) => r.reason === "no_station")).toBe(false);
  });
});
