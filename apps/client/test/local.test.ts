import { describe, it, expect } from "vitest";
import { MemoryWorldStore } from "@engine/persist";
import { NO_ENTITY } from "@engine/net";
import { BuyFromStallCmd } from "@engine/gameplay";
import { gameplayNet } from "@engine/server/protocol";
import { createLocalServer, sendAgentCommands } from "../src/local.js";
import { ClientSession, type KeyValue } from "../src/session.js";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }

/** Runs the in-browser server + client purely on the loopback's virtual clock (no sockets, no timers). */
async function run(ms: number, local: { pump(ms: number): void }, session: ClientSession, world?: { step(dt: number): void }): Promise<void> {
  for (let t = 0; t < ms; t += 50) { local.pump(50); world?.step(1 / 20); session.poll(); await Promise.resolve(); }
}

describe("local/offline mode (in-memory transport)", () => {
  it("hosts the server game module over loopback: connect, account, player spawn, bots join", async () => {
    let r = 0; const rng = (): number => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 5, bots: 2, rng, population: false });
    expect(local.bots.length).toBe(2);
    const session = new ClientSession({ storage: new MapStorage(), slot: "1", sampleButtons: () => 0 });
    const connecting = session.connect("local", "Tess", local.createTransport());
    let world; for (let i = 0; i < 20 && !world; i++) { local.pump(5); world = await Promise.race([connecting, Promise.resolve(undefined)]); }
    world ??= await connecting;
    expect(session.status).toBe("connected");
    await run(3000, local, session, world);
    expect(session.account).toMatch(/^[0-9a-f]{32}$/);
    expect(session.player).toBeDefined();
    expect(local.game.players.size).toBe(3);
    expect([...local.game.players.values()].map((p) => p.name)).toContain("Tess");
    session.disconnect(); await run(200, local, session);
    expect(local.game.players.size).toBe(2);
    await local.stop();
  });

  it("bot AgentOutput.commands take the human command path and are validated identically (refused buy)", async () => {
    let r = 0; const rng = (): number => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 7, bots: 1, rng, population: false });
    const session = new ClientSession({ storage: new MapStorage(), slot: "1", sampleButtons: () => 0 });
    const connecting = session.connect("local", "Hu", local.createTransport());
    let world; for (let i = 0; i < 20 && !world; i++) { local.pump(5); world = await Promise.race([connecting, Promise.resolve(undefined)]); }
    world ??= await connecting;
    await run(2000, local, session, world);
    const human = session.client!, bot = local.bots[0]!.client;
    const got: { who: string; source: string; name: string | undefined; reason: number; detail: string }[] = [];
    human.onCommandRejected((x) => got.push({ who: "human", source: x.source, name: x.command?.name, reason: x.reason, detail: x.detail }));
    bot.onCommandRejected((x) => got.push({ who: "bot", source: x.source, name: x.command?.name, reason: x.reason, detail: x.detail }));
    const payload = { stall: NO_ENTITY, listingSlot: 0, qty: 1, expectedRevision: 0, expectedPriceItem: 0, expectedPriceCount: 0 };
    expect(human.sendCommand(gameplayNet(BuyFromStallCmd), payload)).toBe(true);
    expect(sendAgentCommands(bot, [{ type: BuyFromStallCmd.name, payload }, { type: "no.such.command", payload: {} }])).toBe(1);
    await run(500, local, session, world);
    const h = got.find((g) => g.who === "human"), b = got.find((g) => g.who === "bot");
    expect(h).toBeDefined(); expect(b).toBeDefined();
    expect({ ...b, who: "" }).toEqual({ ...h, who: "" });
    expect(b!.name).toBe(BuyFromStallCmd.name);
    session.disconnect(); await run(200, local, session); await local.stop();
  });
});
