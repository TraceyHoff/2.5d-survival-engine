import { describe, it, expect } from "vitest";
import { Transform, World, type Entity } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { ARMS_EVENT_RELIABILITY, ClanDeclineCmd, emit, Exploded, IntentAction, PlayerIntent, Reloaded, ReloadCmd, VEHICLE_COMMANDS, WearCmd } from "@engine/gameplay";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { CHAT_STYLE_RATE, ExplodedEvt, gameplayNet, onGameplayRejected, ReloadedEvt } from "../src/protocol.js";

async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5, population: false });
  const clients: NetClient[] = []; const rejected = new Map<NetClient, string[]>();
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (): Promise<NetClient> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    rejected.set(c, []); onGameplayRejected(c, (r) => rejected.get(c)!.push(r.reason));
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(4);
    return c;
  };
  const ent = (c: NetClient): Entity => gs.players.get(c.clientId)!.entity;
  const dropped = (c: NetClient): number => gs.net.sessions.get(c.clientId)!.stats.droppedCommands;
  return { gs, tick, connect, ent, dropped, rejected };
}

describe("arms net commands", () => {
  it("ReloadCmd / WearCmd are appended after ClanDeclineCmd (nothing renumbered)", () => {
    const names = DEMO_COMMANDS.map((d) => d.name);
    const iDecline = names.indexOf(ClanDeclineCmd.name);
    expect(names.indexOf(ReloadCmd.name)).toBe(iDecline + 1); expect(names.indexOf(WearCmd.name)).toBe(iDecline + 2);
    expect(names[iDecline + 3]).toBe(VEHICLE_COMMANDS[0]!.name); // later appends (vehicles, ADR-102) follow; nothing before shifts
  });
  it("rates: reload 5/s burst 10, wear chat-style", () => {
    expect(gameplayNet(ReloadCmd).rate).toEqual({ perSec: 5, burst: 10 });
    expect(gameplayNet(WearCmd).rate).toEqual(CHAT_STYLE_RATE);
  });
  for (const [def, values, action] of [[ReloadCmd, {}, IntentAction.Reload], [WearCmd, { slot: 1 }, IntentAction.Wear]] as const) {
    it(`networked ${def.name} queues its intent exactly once`, async () => {
      const s = await setup(); const A = await s.connect();
      let n = 0; let last = 0;
      s.gs.world.addSystem("input", "test.intentProbe", (w) => { const a = w.get(s.ent(A), PlayerIntent)?.action ?? 0; if (a === action && last !== action) n++; last = a; });
      expect(A.sendCommand(gameplayNet(def), values as never)).toBe(true);
      s.tick(8);
      expect(s.dropped(A)).toBe(0); expect(s.rejected.get(A)).toEqual([]);
      expect(n).toBe(1);
    }, 20_000);
  }
});

describe("arms net events", () => {
  it("Exploded is reliable and reaches only clients whose AOI covers the blast", async () => {
    expect(ARMS_EVENT_RELIABILITY["gameplay.Exploded"]).toBe("reliable");
    const s = await setup(); const A = await s.connect(); const B = await s.connect();
    const pa = s.gs.world.get(s.ent(A), Transform)!;
    s.gs.world.set(s.ent(B), Transform, { ...s.gs.world.get(s.ent(B), Transform)!, x: pa.x + 4000, y: pa.y }); s.tick(4);
    const got = new Map<NetClient, { x: number; radius: number }[]>([[A, []], [B, []]]);
    for (const c of [A, B]) c.onEvent(ExplodedEvt, (p) => got.get(c)!.push(p));
    emit(s.gs.world, Exploded, { entity: s.ent(A), item: 7, owner: s.ent(A), x: pa.x + 2, y: pa.y, radius: 3 }); s.tick(3);
    expect(got.get(A)!.length).toBe(1); expect(got.get(A)![0]!.radius).toBeCloseTo(3); expect(got.get(B)).toEqual([]);
    // Blast centred just outside B's AOI but whose radius reaches into it is delivered.
    const pb = s.gs.world.get(s.ent(B), Transform)!; const chunks = s.gs.net.relevantChunks(B.clientId)!;
    let maxX = -Infinity; for (const k of chunks) maxX = Math.max(maxX, (Number(k.split(",")[0]) + 1) * 32);
    emit(s.gs.world, Exploded, { entity: s.ent(A), item: 7, owner: s.ent(A), x: maxX + 5, y: pb.y, radius: 8 }); s.tick(3);
    expect(got.get(B)!.length).toBe(1); expect(got.get(A)!.length).toBe(1);
  }, 20_000);

  it("Reloaded goes only to the owner", async () => {
    const s = await setup(); const A = await s.connect(); const B = await s.connect();
    const got = new Map<NetClient, { rounds: number }[]>([[A, []], [B, []]]);
    for (const c of [A, B]) c.onEvent(ReloadedEvt, (p) => got.get(c)!.push(p));
    emit(s.gs.world, Reloaded, { entity: s.ent(A), item: 3, ammo: 4, rounds: 6 }); s.tick(3);
    expect(got.get(A)!.map((p) => p.rounds)).toEqual([6]); expect(got.get(B)).toEqual([]);
  }, 20_000);
});
