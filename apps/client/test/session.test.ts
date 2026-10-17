import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import type { WebSocketCtor } from "@engine/net";
import { WsServerTransport } from "@engine/net/node";
import { MemoryWorldStore } from "@engine/persist";
import { createGameServer } from "@engine/server";
import { ClientSession, type KeyValue } from "../src/session.js";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }

/** Polls `f` until true; throws (with `what`) after `ms`. Generous: the suite runs in parallel with everything else. */
async function until(what: string, f: () => boolean, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("client session (connect overlay logic)", () => {
  it("connects, stores the account token, and a 'reload' reconnects as the same player", async () => {
    const transport = new WsServerTransport(); const port = await transport.listen(0, "127.0.0.1"); // OS-assigned port, read back
    expect(port).toBeGreaterThan(0);
    const gs = createGameServer({ transport, store: new MemoryWorldStore(), seed: 3 });
    let last = performance.now();
    const timer = setInterval(() => { const n = performance.now(); gs.loop.advance(n - last); last = n; }, 10);
    const storage = new MapStorage(); const url = `ws://127.0.0.1:${port}`;
    const timers: ReturnType<typeof setInterval>[] = []; const sessions: ClientSession[] = [];
    const run = (s: ClientSession, w: { step(dt: number): void }) => { const t = setInterval(() => { w.step(1 / 20); s.poll(); }, 50); timers.push(t); return t; };
    const session = (slot: string): ClientSession => { const s = new ClientSession({ storage, slot, sampleButtons: () => 0, wsCtor: WebSocket as unknown as WebSocketCtor }); sessions.push(s); return s; };
    try {
      const s1 = session("1");
      const w1 = await s1.connect(url, "Tess"); const t1 = run(s1, w1);
      await until("account, rtt and player", () => !!s1.account && s1.rttMs !== undefined && s1.player !== undefined);
      expect(s1.status).toBe("connected"); expect(s1.account).toMatch(/^[0-9a-f]{32}$/); expect(s1.rttMs).toBeLessThan(10_000); // loopback; loose sanity bound only
      expect([...gs.players.values()][0]!.name).toBe("Tess");
      const acct = s1.account;
      clearInterval(t1); s1.disconnect(); await until("player left", () => gs.players.size === 0);
      // "reload": new session object, same storage
      const s2 = session("1");
      expect(s2.savedUrl).toBe(url); expect(s2.savedName).toBe("Tess");
      const w2 = await s2.connect(s2.savedUrl!, s2.savedName!); run(s2, w2);
      await until("account restored", () => s2.restored);
      expect(s2.restored).toBe(true); expect(s2.account).toBe(acct);
      // another slot is a different player
      const s3 = session("2");
      const w3 = await s3.connect(url, "Other"); run(s3, w3);
      await until("second slot account + 2 players", () => !!s3.account && gs.players.size === 2);
      expect(s3.account).not.toBe(acct);
    } finally {
      for (const t of timers) clearInterval(t);
      for (const s of sessions) s.disconnect();
      clearInterval(timer);
      await transport.close();
    }
  }, 60_000);
});
