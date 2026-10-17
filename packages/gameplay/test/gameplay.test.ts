import { describe, it, expect } from "vitest";
import { World, TimeOfDay, encodeSnapshot, setTimeOfDay, timeOfDay } from "@engine/core";
import { GAMEPLAY_SYSTEM_ORDER, IntentAction, installGameplay, setIntent, spawnPlayer, spawnResourceNode } from "../src/index.js";
import { DT } from "./helpers.js";

describe("gameplay install", () => {
  it("advances time of day and wraps days (stub compatibility: numeric dayLengthTicks)", () => {
    const w = new World(); installGameplay(w, 10);
    for (let i = 0; i < 10; i++) w.step(0.05);
    expect(timeOfDay(w).day).toBe(1);
  });

  it("registers systems in the documented order", () => {
    const w = new World(); installGameplay(w);
    const names = (w as unknown as { systems: Map<string, { name: string }[]> }).systems;
    const actual = [...names.entries()].flatMap(([p, l]) => l.map((s) => [p, s.name]));
    expect(actual).toEqual(GAMEPLAY_SYSTEM_ORDER.map(([p, n]) => [p, n]));
  });

  it("has a stable schema hash across worlds (same registration order on client and server)", () => {
    const a = new World(); installGameplay(a, { role: "server" });
    const b = new World(); installGameplay(b, { role: "client" });
    expect(a.getSchemaHash()).toBe(b.getSchemaHash());
  });

  it("is deterministic: same seed + same inputs => identical snapshots and RNG state", () => {
    const run = () => {
      const w = new World({ seed: 99 }); installGameplay(w, { role: "server" });
      const p = spawnPlayer(w, { x: 0, y: 0 });
      const bush = spawnResourceNode(w, "berry_bush", 1, 0);
      const grass = spawnResourceNode(w, "fiber_grass", 0, 1);
      for (let t = 0; t < 400; t++) {
        if (t % 25 === 0) setIntent(w, p, { action: IntentAction.Gather, target: t % 50 === 0 ? bush : grass });
        if (t === 300) setIntent(w, p, { action: IntentAction.Use, slot: 0 });
        setIntent(w, p, { moving: 1, sprint: t % 7 === 0 ? 1 : 0 });
        w.step(DT);
      }
      return { snap: encodeSnapshot(w, { all: true }), rng: w.rng.state };
    };
    const a = run(), b = run();
    expect(a.rng).toBe(b.rng);
    expect(Buffer.from(a.snap).equals(Buffer.from(b.snap))).toBe(true);
  });
});
