import { describe, it, expect } from "vitest";
import { MemoryWorldStore } from "@engine/persist";
import { applyDamage, Dead, deathBagsOf, Health, PVP, RespawnCmd, addItem, defaultDefs } from "@engine/gameplay";
import { PlayerId } from "@engine/core";
import { gameplayNet } from "@engine/server/protocol";
import { createLocalServer } from "../src/local.js";
import { ClientSession, type KeyValue } from "../src/session.js";

class S implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }

describe("ADR-153 singleplayer (in-process server) die -> respawn", () => {
  it("the client's Respawn command revives the player through the local server", async () => {
    const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 5, bots: 0, maxBots: 0, population: false });
    const session = new ClientSession({ storage: new S(), slot: "1", sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }) });
    const c = session.connect("local", "T", local.createTransport());
    let world; for (let i = 0; i < 50 && !world; i++) { local.pump(5); world = await Promise.race([c, Promise.resolve(undefined)]); }
    world ??= await c;
    const step = (n: number) => { for (let i = 0; i < n; i++) { local.pump(50); world!.step(1 / 20); session.poll(); } };
    step(20); const sw = local.game.world; const p = session.player!; const pid = world.getField(p, PlayerId, "id")!;
    const se = [...sw.query([PlayerId])].find((e) => sw.getField(e, PlayerId, "id") === pid)!;
    addItem(sw, se, defaultDefs().itemId("planks"), 3, pid);
    applyDamage(sw, se, 1e6, se); step(4);
    expect(world.has(p, Dead)).toBe(true); expect(deathBagsOf(world, pid)).toHaveLength(1);
    step(Math.ceil(PVP.respawnSeconds * 20) + 2);
    expect(session.client!.sendCommand(gameplayNet(RespawnCmd), {} as never)).not.toBe(false); step(6);
    expect(sw.has(se, Dead)).toBe(false); expect(world.has(session.player!, Dead)).toBe(false);
    expect(world.getField(session.player!, Health, "hp")).toBeGreaterThan(0);
    expect(deathBagsOf(world, pid)).toHaveLength(1); // bag still there to retrieve
    session.disconnect(); await local.stop();
  });
});
