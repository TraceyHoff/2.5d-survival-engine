import { describe, expect, it } from "vitest";
import { MemoryWorldStore } from "@engine/persist";
import { worldRules } from "@engine/gameplay";
import { createLocalServer, aiHumansOn, type LocalServer } from "../src/local.js";
import { ClientSession } from "../src/session.js";

function storage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; }
async function connect(local: LocalServer, name: string): Promise<ClientSession> {
  const s = new ClientSession({ storage: storage(), slot: name, sampleButtons: () => 0 });
  let done = false; let error: unknown; const p = s.connect("local", name, local.createTransport()).then(() => { done = true; }, (e: unknown) => { error = e; done = true; });
  for (let i = 0; i < 100 && !done; i++) { local.pump(50); s.poll(); await Promise.resolve(); }
  await p; if (error) { s.disconnect(); throw error; } return s;
}
describe("ADR-258 AI humans and real join slots", () => {
  it("explicit AI-off beats old saved AI-on, disables population/virtual joins, and persists on save", async () => {
    const store = new MemoryWorldStore(); await store.write({ meta: { seed: 5, tick: 0, schemaHash: 0, aiHumans: 1 } });
    const opts = { mode: "multiplayer" as const, store, worldRules: { aiHumans: false } };
    expect(aiHumansOn(opts)).toBe(false);
    const l = await createLocalServer({ ...opts, seed: 5, maxClients: 2 });
    const sessions: ClientSession[] = [];
    try {
      expect(worldRules(l.game.world).aiHumans).toBe(false); expect(l.game.modeConfig.humanBots).toBe(false);
      sessions.push(await connect(l, "Host"));
      for (let i = 0; i < 240; i++) { l.pump(50); await Promise.resolve(); }
      expect(l.bots).toEqual([]); expect(l.game.players.size).toBe(1);
      expect(l.game.markVirtual(sessions[0]!.client!.clientId)).toBe(false);
      sessions.push(await connect(l, "Real guest")); expect(l.game.players.size).toBe(2);
    } finally { for (const s of sessions) s.disconnect(); await l.stop(); }
    expect(store.readMeta()?.aiHumans).toBe(0);
    expect(aiHumansOn({ mode: "multiplayer", store })).toBe(false);
  });
  it("explicit AI-on can override a saved off rule; an unspecified setting preserves the save", async () => {
    const store = new MemoryWorldStore(); await store.write({ meta: { seed: 5, tick: 0, schemaHash: 0, aiHumans: 0 } });
    expect(aiHumansOn({ mode: "multiplayer", store })).toBe(false);
    expect(aiHumansOn({ mode: "multiplayer", store, worldRules: { aiHumans: true } })).toBe(true);
    const l = await createLocalServer({ mode: "multiplayer", store, worldRules: { aiHumans: true }, population: false });
    try { expect(worldRules(l.game.world).aiHumans).toBe(true); expect(l.game.modeConfig.humanBots).toBe(true); } finally { await l.stop(); }
  });
  it("trusted direct AI clients do not consume the real-player cap, but a third human is still refused", async () => {
    const l = await createLocalServer({ seed: 5, bots: 2, maxClients: 2, population: false }); const sessions: ClientSession[] = [];
    try {
      expect(l.bots).toHaveLength(2);
      sessions.push(await connect(l, "Host"), await connect(l, "Guest"));
      expect(l.game.players.size).toBe(4);
      await expect(connect(l, "Over cap")).rejects.toThrow(/full/i);
    } finally { for (const s of sessions) s.disconnect(); await l.stop(); }
  });
});
