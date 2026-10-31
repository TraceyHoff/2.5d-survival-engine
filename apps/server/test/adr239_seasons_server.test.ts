// ADR-239: the season phase persists in save meta and replicates to clients (Season + TimeOfDay + Weather on the env entity).
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Season, seasonAt, seasonAtDays, setSeason, timeOfDay, Weather, World, dayFractionAt, TimeOfDay } from "@engine/core";
import { isSnowing } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { SqliteWorldStore } from "@engine/persist/node";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { restoreSeason } from "../src/game.js";

describe("ADR-239 seasons on the server", { timeout: 30_000 }, () => {
  it("the season survives shutdown + reload (SQLite meta seasonOffsetDays)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "season-")); const path = join(dir, "w.sqlite");
    try {
      const g1 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store: await SqliteWorldStore.open(path), seed: 3, population: false });
      setSeason(g1.world, 2, 1); const s1 = seasonAt(g1.world); const off = g1.world.env(Season).offsetDays;
      await g1.shutdown();
      const s2 = await SqliteWorldStore.open(path); expect(s2.readMeta()?.seasonOffsetDays).toBe(off);
      const g2 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store: s2, seed: 3, population: false });
      expect(seasonAt(g2.world).index).toBe(2); expect(seasonAt(g2.world).into).toBeCloseTo(s1.into, 3);
      await g2.shutdown();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("saves without seasonOffsetDays keep the install default", () => {
    const w = new World({ seed: 1, maxEntities: 64 }); installDemoWorld(w, "server"); const before = w.env(Season).offsetDays;
    restoreSeason(w, {}); expect(w.env(Season).offsetDays).toBe(before);
    restoreSeason(w, { seasonOffsetDays: 4 }); expect(w.env(Season).offsetDays).toBe(4);
  });
  it("clients receive the season and the server's weather (never snow in a replicated summer)", async () => {
    const net = new LoopbackNetwork(5);
    const gs = createGameServer({ transport: net.createServer(), seed: 9, population: false });
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const client = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = client.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p;
    const tick = (n: number): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); world.step(1 / 20); client.pollEvents(Infinity); } };
    setSeason(gs.world, 1, 1); tick(10);
    const days = (): number => { const td = world.env(TimeOfDay); return (client.serverTickEstimate - td.epochTick) / td.dayLengthTicks; };
    expect(world.env(Season).offsetDays).toBe(gs.world.env(Season).offsetDays);
    expect(world.env(Season).lengthDays).toBe(gs.world.env(Season).lengthDays);
    expect(seasonAtDays(world, days()).index).toBe(1);
    expect(Math.abs(seasonAtDays(world, days()).into - seasonAt(gs.world).into)).toBeLessThan(0.01);
    expect(dayFractionAt(client.serverTickEstimate, world.env(TimeOfDay).epochTick, world.env(TimeOfDay).dayLengthTicks)).toBeCloseTo(timeOfDay(gs.world).t, 2);
    setSeason(gs.world, 0, 1); gs.world.env(Weather).endsAtTick = 0; tick(10);
    expect(seasonAtDays(world, days()).index).toBe(0);
    expect(world.env(Weather).kind).toBe(gs.world.env(Weather).kind); expect(isSnowing(world.env(Weather).kind)).toBe(false);
    await gs.shutdown();
  });
});
