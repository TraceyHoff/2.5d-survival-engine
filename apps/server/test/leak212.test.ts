import { describe, it, expect } from "vitest";
import { Transform, World } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

/** ADR-212 leak regression (Xbox Edge crashes): long play must not grow per-session / per-world bookkeeping without bound. */
describe("ADR-212 bounded server/client state over a long session", { timeout: 120_000 }, () => {
  it("snapshot history, linger, interest change log, client maps and entity counts stay bounded", async () => {
    const net = new LoopbackNetwork(3);
    const gs = createGameServer({ transport: net.createServer(), seed: 212, devSandbox: true, store: new MemoryWorldStore() });
    const clients: NetClient[] = [];
    for (let i = 0; i < 2; i++) {
      const world = new World({ seed: 1 }); installDemoWorld(world, "client");
      const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd, 1 / 20) });
      const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    }
    let t = 0;
    const tick = (n: number): void => { for (let i = 0; i < n; i++, t++) {
      // walk both players around a large loop that crosses many chunks (AOI churn), like exploring
      let k = 0; for (const p of gs.players.values()) { const tr = gs.world.get(p.entity, Transform)!; const a = t / 400 + k++ * Math.PI;
        gs.world.set(p.entity, Transform, { ...tr, x: 64 + Math.cos(a) * 150, y: 64 + Math.sin(a) * 150 }); }
      net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
    const sample = () => {
      const sess = [...(gs.net as unknown as { byConn: Map<unknown, { views: Map<number, unknown>; linger: Map<number, number> }> }).byConn.values()];
      return {
        views: Math.max(...sess.map((s) => s.views.size)), linger: Math.max(...sess.map((s) => s.linger.size)),
        log: (gs.net.interest!.membership as unknown as { logE: unknown[] }).logE.length,
        persistLog: gs.persist ? (gs.persist.membership as unknown as { logE: unknown[] }).logE.length : 0,
        serverEntities: gs.world.entityCount, clientEntities: Math.max(...clients.map((c) => c.entities.size)),
        clientWorld: Math.max(...clients.map((c) => c.world.entityCount)), history: Math.max(...clients.map((c) => (c as unknown as { history: Map<number, unknown> }).history.size)),
      };
    };
    tick(400); const warm = sample();
    let peak = warm; for (let r = 0; r < 4; r++) { tick(400); const s = sample(); peak = { ...s, serverEntities: Math.max(peak.serverEntities, s.serverEntities), clientWorld: Math.max(peak.clientWorld, s.clientWorld) }; }
    const end = sample();
    expect(end.views).toBeLessThanOrEqual(gs.net.historySize + 1);
    expect(end.log).toBe(0); expect(end.persistLog).toBe(0);
    expect(end.history).toBeLessThanOrEqual(64);
    // no unbounded accumulation: world/replica sizes plateau (population + streaming are capped), linger drains
    expect(end.serverEntities).toBeLessThan(warm.serverEntities * 2);
    expect(end.clientWorld).toBeLessThan(warm.clientWorld * 1.5 + 200);
    expect(end.clientEntities).toBeLessThanOrEqual(end.clientWorld);
    expect(end.linger).toBeLessThan(2000);
    console.log("[leak212]", JSON.stringify({ warm, end, peak }));
  });
});
