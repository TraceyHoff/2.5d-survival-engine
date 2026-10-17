import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import type { WebSocketCtor } from "@engine/net";
import { WsServerTransport } from "@engine/net/node";
import { MemoryWorldStore } from "@engine/persist";
import { createGameServer } from "@engine/server";
import { ClientSession, type KeyValue } from "../src/session.js";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }

describe("client session (connect overlay logic)", () => {
  it("connects, stores the account token, and a 'reload' reconnects as the same player", async () => {
    const transport = new WsServerTransport(); const port = await transport.listen(0, "127.0.0.1");
    const gs = createGameServer({ transport, store: new MemoryWorldStore(), seed: 3 });
    let last = performance.now();
    const timer = setInterval(() => { const n = performance.now(); gs.loop.advance(n - last); last = n; }, 10);
    const until = async (f: () => boolean, ms = 4000): Promise<void> => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); };
    const storage = new MapStorage(); const url = `ws://127.0.0.1:${port}`;
    const run = (s: ClientSession, w: { step(dt: number): void }) => setInterval(() => { w.step(1 / 20); s.poll(); }, 50);
    try {
      const s1 = new ClientSession({ storage, slot: "1", sampleButtons: () => 0, wsCtor: WebSocket as unknown as WebSocketCtor });
      const w1 = await s1.connect(url, "Tess"); const t1 = run(s1, w1);
      await until(() => !!s1.account && s1.rttMs !== undefined && s1.player !== undefined);
      expect(s1.status).toBe("connected"); expect(s1.account).toMatch(/^[0-9a-f]{32}$/); expect(s1.rttMs).toBeLessThan(500);
      expect([...gs.players.values()][0]!.name).toBe("Tess");
      const acct = s1.account;
      clearInterval(t1); s1.disconnect(); await until(() => gs.players.size === 0);
      // "reload": new session object, same storage
      const s2 = new ClientSession({ storage, slot: "1", sampleButtons: () => 0, wsCtor: WebSocket as unknown as WebSocketCtor });
      expect(s2.savedUrl).toBe(url); expect(s2.savedName).toBe("Tess");
      const w2 = await s2.connect(s2.savedUrl!, s2.savedName!); const t2 = run(s2, w2);
      await until(() => s2.restored);
      expect(s2.restored).toBe(true); expect(s2.account).toBe(acct);
      // another slot is a different player
      const s3 = new ClientSession({ storage, slot: "2", sampleButtons: () => 0, wsCtor: WebSocket as unknown as WebSocketCtor });
      const w3 = await s3.connect(url, "Other"); const t3 = run(s3, w3);
      await until(() => !!s3.account);
      expect(s3.account).not.toBe(acct); expect(gs.players.size).toBe(2);
      clearInterval(t2); clearInterval(t3); s2.disconnect(); s3.disconnect();
    } finally { clearInterval(timer); await transport.close(); }
  }, 15000);
});
