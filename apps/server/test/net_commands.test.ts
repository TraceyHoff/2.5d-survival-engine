import { describe, it, expect } from "vitest";
import { NetId, Transform, World, type Entity } from "@engine/core";
import { ChatChannel, LoopbackNetwork, NetClient, NO_ENTITY, eidOfNetId, netIdOf } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { CollectTillCmd, EmoteCmd, Expression, EXPRESSION_DATA, emoteId, emoteNames, expressionId, LootBag, PlaceCmd, PlayerIntent, IntentAction, UseCmd } from "@engine/gameplay";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { SPAWN } from "../src/game.js";
import { CHAT_STYLE_RATE, gameplayNet, onGameplayRejected, SOCIAL_COMMAND_NAMES } from "../src/protocol.js";

async function setup() {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), spawnPoints: [SPAWN], store: new MemoryWorldStore(), seed: 5, population: false });
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
  const pos = (c: NetClient): { x: number; y: number } => gs.world.get(ent(c), Transform)!;
  const thing = (x: number, y: number): Entity => { const e = gs.world.create(); gs.world.add(e, Transform, { x, y }); gs.net.netIds.assign(e); return e; };
  const dropped = (c: NetClient): number => gs.net.sessions.get(c.clientId)!.stats.droppedCommands;
  /** Send a command naming a raw server NetId (what a bot reads off its client view), bypassing local-entity mapping. */
  const sendRawTarget = (c: NetClient, netId: number): void => {
    const fake = 0x7ffffff0 as Entity; (c as unknown as { netOf: Map<Entity, number> }).netOf.set(fake, netId);
    c.sendCommand(gameplayNet(CollectTillCmd), { stall: fake }); (c as unknown as { netOf: Map<Entity, number> }).netOf.delete(fake);
  };
  return { gs, tick, connect, ent, pos, thing, dropped, sendRawTarget, rejected };
}

describe("net copies of gameplay Use / Place / Emote", () => {
  it("UseCmd and PlaceCmd reach the gameplay intent queue; EmoteCmd sets Expression", async () => {
    const s = await setup(); const A = await s.connect();
    expect(A.sendCommand(gameplayNet(UseCmd), { slot: 2 })).toBe(true);
    expect(A.sendCommand(gameplayNet(PlaceCmd), { piece: 1, x: 3.5, y: 4.5, level: 0, rot: 1, tier: 0, variant: 0 })).toBe(true);
    const seen: number[] = []; // PlayerIntent right after gameplay.commands (same input phase, registered later)
    s.gs.world.addSystem("input", "test.intentProbe", (w) => { const a = w.get(s.ent(A), PlayerIntent)?.action; if (a) seen.push(a); });
    s.tick(6);
    expect(s.dropped(A)).toBe(0);
    expect(seen).toContain(IntentAction.Use); expect(seen).toContain(IntentAction.Place);
    A.sendCommand(gameplayNet(EmoteCmd), { emote: emoteId("laugh") }); s.tick(8);
    expect(s.gs.world.get(s.ent(A), Expression)?.id).toBe(expressionId(EXPRESSION_DATA.emotes.laugh!.expression));
    A.sendCommand(gameplayNet(EmoteCmd), { emote: emoteNames().length + 1 }); s.tick(3);
    expect(s.rejected.get(A)).toContain("bad_emote");
  }, 20_000);

  it("chat emotes map to EmoteCmd ids (emoteNames index + 1)", async () => {
    const s = await setup(); const A = await s.connect();
    const name = emoteNames()[2]!; expect(emoteId(name)).toBe(3);
    A.chat.send(ChatChannel.Local, "boo hoo", { emote: emoteId(name) }); s.tick(8);
    expect(s.gs.world.get(s.ent(A), Expression)?.id).toBe(expressionId(EXPRESSION_DATA.emotes[name]!.expression));
  }, 20_000);

  it("social commands use the chat-style rate; party/kick names are pre-registered", () => {
    expect(gameplayNet(EmoteCmd).rate).toEqual(CHAT_STYLE_RATE);
    for (const n of ["gameplay.partyInvite", "gameplay.partyAccept", "gameplay.partyDecline", "gameplay.partyLeave", "gameplay.partyKick"]) expect(SOCIAL_COMMAND_NAMES.has(n)).toBe(true);
    for (const n of ["gameplay.clanCreate", "gameplay.clanInvite", "gameplay.clanAccept", "gameplay.clanLeave", "gameplay.clanPromote", "gameplay.clanDemote", "gameplay.clanKick", "gameplay.clanSetRankPerms", "gameplay.clanDisband", "gameplay.clanSetGoal"]) expect(SOCIAL_COMMAND_NAMES.has(n), n).toBe(true);
  });
});

describe("entity targets are NetIds, validated per client", () => {
  it("netIdOf / eidOfNetId map between a client view and the server world", async () => {
    const s = await setup(); const A = await s.connect(); const p = s.pos(A);
    const e = s.thing(p.x + 1, p.y); s.tick(4);
    const nid = s.gs.world.getField(e, NetId, "id")!;
    expect(netIdOf(s.gs.world, e)).toBe(nid); expect(eidOfNetId(s.gs.world, nid)).toBe(e);
    const local = eidOfNetId(A.world, nid)!; expect(local).toBeDefined(); expect(netIdOf(A.world, local)).toBe(nid);
    expect(eidOfNetId(A.world, 0x7fffff)).toBeUndefined();
  }, 20_000);

  it("in-AOI target resolves; unknown, stale and out-of-AOI targets are rejected (badEntityRef)", async () => {
    const s = await setup(); const A = await s.connect(); const p = s.pos(A);
    const bad: string[] = []; s.gs.net.onAnomaly((_s, k, d) => { if (k === "badEntityRef") bad.push(d); });
    const near = s.thing(p.x + 1, p.y); const far = s.thing(p.x + 5000, p.y); s.tick(4);
    const nid = (e: Entity): number => s.gs.world.getField(e, NetId, "id")!;
    s.sendRawTarget(A, nid(near)); s.tick(3);
    expect(s.rejected.get(A)).toEqual(["not_stall"]); expect(s.dropped(A)).toBe(0); // resolved to the entity; gameplay validated it
    s.sendRawTarget(A, 0x7ffff0); s.tick(3); expect(s.dropped(A)).toBe(1); // unknown
    s.sendRawTarget(A, nid(far)); s.tick(3); expect(s.dropped(A)).toBe(2); // alive, but not in A's view
    const stale = nid(near); s.gs.world.destroy(near); s.tick(2);
    s.sendRawTarget(A, stale); s.tick(3); expect(s.dropped(A)).toBe(3); // despawned
    expect(bad).toEqual(["gameplay.collectTill", "gameplay.collectTill", "gameplay.collectTill"]);
    expect(s.rejected.get(A)).toEqual(["not_stall"]);
    expect(NO_ENTITY).toBe(0xffffffff);
  }, 20_000);

  it("ownerless (animal) loot bags replicate to every client in AOI", async () => {
    const s = await setup(); const A = await s.connect(); const B = await s.connect(); const C = await s.connect();
    const p = s.pos(A); s.gs.world.setField(s.ent(C), Transform, "x", p.x + 5000); s.tick(4);
    const bag = s.thing(p.x + 2, p.y); s.gs.world.add(bag, LootBag, { owner: 0, despawnAtTick: 1_000_000 }); s.tick(5);
    const nid = s.gs.world.getField(bag, NetId, "id")!;
    for (const c of [A, B]) { const l = eidOfNetId(c.world, nid); expect(l).toBeDefined(); expect(c.world.get(l!, LootBag)?.owner).toBe(0); }
    expect(eidOfNetId(C.world, nid)).toBeUndefined();
  }, 20_000);
});

describe("party rates and single-path Use/Place/Emote", () => {
  it("all five gameplay.party* commands get CHAT_STYLE_RATE", async () => {
    const { GAMEPLAY_NET_COMMANDS } = await import("../src/protocol.js");
    const names = ["gameplay.partyInvite", "gameplay.partyAccept", "gameplay.partyDecline", "gameplay.partyLeave", "gameplay.partyKick"];
    for (const n of names) {
      const m = GAMEPLAY_NET_COMMANDS.filter((c) => c.core.name === n);
      expect(m.length, n).toBe(1);
      expect(m[0]!.net.rate, n).toEqual(CHAT_STYLE_RATE);
    }
  });
  it("all ten gameplay.clan* commands are registered once with CHAT_STYLE_RATE", async () => {
    const { GAMEPLAY_NET_COMMANDS } = await import("../src/protocol.js");
    for (const n of ["gameplay.clanCreate", "gameplay.clanInvite", "gameplay.clanAccept", "gameplay.clanLeave", "gameplay.clanPromote", "gameplay.clanDemote", "gameplay.clanKick", "gameplay.clanSetRankPerms", "gameplay.clanDisband", "gameplay.clanSetGoal"]) {
      const m = GAMEPLAY_NET_COMMANDS.filter((c) => c.core.name === n);
      expect(m.length, n).toBe(1); expect(m[0]!.net.rate, n).toEqual(CHAT_STYLE_RATE);
    }
  });
  it("Use/Place/Emote are registered once and a single send runs once", async () => {
    const { GAMEPLAY_NET_COMMANDS } = await import("../src/protocol.js");
    const { GAMEPLAY_COMMANDS } = await import("@engine/gameplay");
    for (const d of [UseCmd, PlaceCmd, EmoteCmd]) expect(GAMEPLAY_NET_COMMANDS.filter((c) => c.core.name === d.name).length, d.name).toBe(1);
    // game.ts routes a command through exactly one path: the intent queue (GAMEPLAY_COMMANDS) or the handler queue, never both.
    const queued = new Set(GAMEPLAY_COMMANDS.map(([d]) => d.name));
    expect(queued.has(UseCmd.name)).toBe(true); expect(queued.has(PlaceCmd.name)).toBe(true); expect(queued.has(EmoteCmd.name)).toBe(false);
    const s = await setup(); const A = await s.connect();
    const seen: number[] = [];
    s.gs.world.addSystem("input", "test.onceProbe", (w) => { const a = w.get(s.ent(A), PlayerIntent)?.action; if (a) seen.push(a); });
    A.sendCommand(gameplayNet(UseCmd), { slot: 2 }); s.tick(10);
    expect(seen.filter((a) => a === IntentAction.Use).length).toBe(1);
  });
});
