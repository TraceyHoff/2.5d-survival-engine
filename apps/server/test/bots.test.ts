import { describe, it, expect } from "vitest";
import { Transform } from "@engine/core";
import { WsServerTransport } from "@engine/net/node";
import { MemoryWorldStore } from "@engine/persist";
import { createGameServer } from "../src/main.js";
import { startBot, startBots } from "../src/bots.js";

describe("headless bots over WebSocket", () => {
  it("bots connect over ws, get accounts, move, and reconnect as the same player", async () => {
    const transport = new WsServerTransport(); const port = await transport.listen(0, "127.0.0.1");
    const gs = createGameServer({ transport, store: new MemoryWorldStore(), seed: 5 });
    let last = performance.now();
    const timer = setInterval(() => { const n = performance.now(); gs.loop.advance(n - last); last = n; }, 10);
    const until = async (f: () => boolean, ms = 4000): Promise<void> => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25)); };
    try {
      const swarm = await startBots(`ws://127.0.0.1:${port}`, 3);
      await until(() => gs.players.size === 3 && swarm.bots.every((b) => b.account));
      expect(gs.players.size).toBe(3);
      const start = [...gs.players.values()].map((p) => ({ ...gs.world.get(p.entity, Transform)! }));
      await new Promise((r) => setTimeout(r, 1500));
      const moved = [...gs.players.values()].filter((p, i) => JSON.stringify(gs.world.get(p.entity, Transform)) !== JSON.stringify(start[i])).length;
      expect(moved).toBeGreaterThan(0);
      const account = swarm.bots[0]!.account!;
      swarm.stop(); await until(() => gs.players.size === 0);
      expect(gs.players.size).toBe(0);
      const b = await startBot({ url: `ws://127.0.0.1:${port}`, index: 0, token: account });
      await until(() => b.restored);
      expect(b.restored).toBe(true); expect(b.account).toBe(account);
      b.stop();
    } finally { clearInterval(timer); await transport.close(); }
  }, 15000);
});
