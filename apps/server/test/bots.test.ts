import { describe, it, expect } from "vitest";
import { Transform } from "@engine/core";
import { WsServerTransport } from "@engine/net/node";
import { MemoryWorldStore } from "@engine/persist";
import { createGameServer } from "../src/main.js";
import { startBot, startBots, type Bot } from "../src/bots.js";

/** Polls `f` until true; throws (with `what`) after `ms`. Generous by default: the suite runs in parallel with everything else. */
async function until(what: string, f: () => boolean, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("headless bots over WebSocket", () => {
  it("bots connect over ws, get accounts, move, and reconnect as the same player", async () => {
    const transport = new WsServerTransport();
    const port = await transport.listen(0, "127.0.0.1"); // OS-assigned port, read back
    expect(port).toBeGreaterThan(0);
    const url = `ws://127.0.0.1:${port}`;
    process.env["NET_DEV_BOTS"] = "1"; // dev load-test tool: bots refuse to start without it
    const gs = createGameServer({ transport, store: new MemoryWorldStore(), seed: 5, devBots: true });
    let last = performance.now();
    const timer = setInterval(() => { const n = performance.now(); gs.loop.advance(n - last); last = n; }, 10);
    const bots: Bot[] = [];
    try {
      // rng 0.5 -> every bot always walks right (no gather/idle picks), so "moved" is a condition, not luck.
      const swarm = await startBots(url, 3, undefined, () => {}, () => () => 0.5);
      bots.push(...swarm.bots);
      expect(swarm.bots.length).toBe(3);
      await until("3 players with accounts", () => gs.players.size === 3 && swarm.bots.every((b) => b.account));
      const start = new Map([...gs.players.values()].map((p) => [p.entity, gs.world.get(p.entity, Transform)!.x]));
      await until("every bot moved", () => [...gs.players.values()].every((p) => gs.world.get(p.entity, Transform)!.x > start.get(p.entity)! + 0.5));
      const account = swarm.bots[0]!.account!;
      swarm.stop();
      await until("all players left", () => gs.players.size === 0);
      const b = await startBot({ url, index: 0, token: account, rng: () => 0.5 });
      bots.push(b);
      await until("account restored", () => b.restored);
      expect(b.account).toBe(account);
      expect(gs.players.size).toBe(1);
    } finally {
      for (const b of bots) b.stop();
      clearInterval(timer);
      await transport.close();
    }
  }, 60_000);
});
