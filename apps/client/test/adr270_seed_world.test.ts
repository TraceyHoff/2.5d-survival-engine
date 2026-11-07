import { describe, expect, it } from "vitest";
import { MemoryWorldStore } from "@engine/persist";
import { createLocalServer } from "../src/local.js";
import { parseWorldSeed } from "../src/world-seed.js";

describe("ADR-270: chosen seed reaches the existing world generator", () => {
  for (const mode of ["singleplayer", "multiplayer"] as const) {
    for (const text of ["424242", "", "0"]) it(`${mode}: '${text}' creates a world and continuing preserves its seed`, async () => {
      const seed = parseWorldSeed(text, 92834)!; const store = new MemoryWorldStore();
      const local = await createLocalServer({ seed, store, mode, bots: 0, population: false });
      expect(local.game.world.seed).toBe(seed); await local.game.persist!.saveAll();
      expect(store.readMeta()?.seed).toBe(seed); await local.stop();
      const resumed = await createLocalServer({ seed: 999, store, mode, bots: 0, population: false });
      expect(resumed.game.world.seed).toBe(seed); await resumed.stop();
    });
  }
});
