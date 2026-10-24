import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopbackNetwork } from "@engine/net";
import { TimeOfDay, World, setTimeOfDay, timeOfDay } from "@engine/core";
import { SqliteWorldStore } from "@engine/persist/node";
import { createGameServer } from "../src/main.js";
import { LEGACY_START_TIME_OF_DAY, restoreDayClock } from "../src/game.js";

describe("ADR-107 day clock persists in save meta", () => {
  it("a world keeps its time of day across shutdown + reload (SQLite)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dayclock-")); const path = join(dir, "w.sqlite");
    try {
      const g1 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store: await SqliteWorldStore.open(path), seed: 3, population: false });
      setTimeOfDay(g1.world, 15.5); const h1 = timeOfDay(g1.world).hours; const e1 = g1.world.env(TimeOfDay).epochTick;
      await g1.shutdown();
      const s2 = await SqliteWorldStore.open(path); expect(s2.readMeta()?.dayEpochTick).toBe(e1);
      const g2 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store: s2, seed: 3, population: false });
      expect(timeOfDay(g2.world).hours).toBeCloseTo(h1, 6);
      await g2.shutdown();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("saves without dayEpochTick fall back to the legacy 0.25 start", () => {
    const w = new World({ seed: 1, maxEntities: 16 }); w.env(TimeOfDay).dayLengthTicks = 72000; w.tick = 18000;
    restoreDayClock(w, {}); expect(timeOfDay(w).t).toBeCloseTo(LEGACY_START_TIME_OF_DAY + 0.25, 9);
    restoreDayClock(w, { dayEpochTick: 1000 }); expect(timeOfDay(w).tickOfDay).toBe(17000);
  });
});
