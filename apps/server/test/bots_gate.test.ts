import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { World } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, DevBotHello, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { assertDevBots, DEV_BOTS_REFUSAL } from "../src/bots.js";
import { devBotsFromEnv, type GameServerOptions } from "../src/game.js";

async function setup(o: Partial<GameServerOptions> = {}) {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5, ...o });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (bot: boolean): Promise<NetClient> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    if (bot) c.sendCommand(DevBotHello, { v: 1 });
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(4);
    return c;
  };
  return { gs, tick, connect };
}

describe("dev bots are multiplayer-gated", () => {
  it("a multiplayer server (the default) spawns no bots on its own and drops bot-tagged connections without the dev flag", async () => {
    const s = await setup(); s.tick(40);
    expect(s.gs.players.size).toBe(0); // nothing spawns players/bots by itself
    const human = await s.connect(false); const bot = await s.connect(true); s.tick(4);
    expect(s.gs.players.has(human.clientId!)).toBe(true);
    expect(s.gs.players.has(bot.clientId!)).toBe(false);
    expect(s.gs.players.size).toBe(1);
  });
  it("bot-tagged connections are accepted with devBots (NET_DEV_BOTS=1) or in singleplayer mode", async () => {
    for (const o of [{ devBots: true }, { mode: "singleplayer" as const }]) {
      const s = await setup(o); const bot = await s.connect(true); s.tick(4);
      expect(s.gs.players.has(bot.clientId!)).toBe(true);
    }
  });
  it("bots.ts refuses to start without NET_DEV_BOTS=1; the production server path never imports it", () => {
    expect(() => assertDevBots({})).toThrow(DEV_BOTS_REFUSAL);
    expect(() => assertDevBots({ NET_DEV_BOTS: "1" })).not.toThrow();
    expect(devBotsFromEnv({})).toBe(false); expect(devBotsFromEnv({ NET_DEV_BOTS: "1" })).toBe(true);
    for (const f of ["main.ts", "game.ts", "protocol.ts"]) expect(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).not.toMatch(/from "\.\/bots(\.js)?"|import\("\.\/bots/);
  });
});
