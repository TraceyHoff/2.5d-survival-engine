import { describe, it, expect } from "vitest";
import { MemoryWorldStore } from "@engine/persist";
import { createLocalServer } from "../src/local.js";
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
});
