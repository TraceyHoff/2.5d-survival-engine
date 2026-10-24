import { describe, it, expect } from "vitest";
import { Appearance, defaultAppearance, setAppearance, World } from "@engine/core";
import { Survival, Inventory, Equipment } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, DevBotHello, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { SPAWN } from "../src/game.js";

/** Every player's look (core Appearance, scope "all"; Equipment, scope "all") reaches every client in AOI; vitals stay owner-only. */
describe("public look", () => {
  it("client B sees client A's look and a bot's look; A's Survival/Inventory stay private", async () => {
    const net = new LoopbackNetwork(3);
    const gs = createGameServer({ transport: net.createServer(), spawnPoints: [SPAWN], store: new MemoryWorldStore(), seed: 5, devBots: true });
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
    const A = await connect(false); const bot = await connect(true); const B = await connect(false);
    const look = (tone: number) => ({ ...defaultAppearance(), skinTone: tone, bodyType: 1 });
    const ent = (c: NetClient) => gs.players.get(c.clientId!)!.entity;
    expect(gs.players.get(bot.clientId!)!.bot).toBe(true);
    setAppearance(gs.world, ent(A), look(3)); setAppearance(gs.world, ent(bot), look(7)); setAppearance(gs.world, ent(B), look(5));
    tick(6);
    const tones = [...B.world.query([Appearance])].map((e) => B.world.get(e, Appearance)!.skinTone).sort();
    expect(tones).toEqual([3, 5, 7]);
    const others = [...B.world.query([Appearance])].filter((e) => B.world.get(e, Appearance)!.skinTone !== 5);
    for (const e of others) { expect(B.world.has(e, Survival)).toBe(false); expect(B.world.has(e, Inventory)).toBe(false); expect(B.world.has(e, Equipment)).toBe(true); }
    // the owner still gets its own private stats
    const mine = [...A.world.query([Appearance])].find((e) => A.world.get(e, Appearance)!.skinTone === 3)!;
    expect(A.world.has(mine, Survival)).toBe(true);
  }, 20_000);
});
