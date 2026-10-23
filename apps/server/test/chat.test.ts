import { describe, it, expect } from "vitest";
import { PlayerId, Transform, World } from "@engine/core";
import { ChatChannel, ChatReject, GroupKind, GroupRole, LoopbackNetwork, NetClient, type ChatDelivered } from "@engine/net";
import { ClaimAccount, MemoryWorldStore } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, DevBotHello, DEMO_COMMANDS, DEMO_EVENTS, type GameServerOptions } from "../src/main.js";

async function setup(o: Partial<GameServerOptions> = {}) {
  const net = new LoopbackNetwork(3);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5, devBots: true, ...o });
  const clients: NetClient[] = []; const inbox = new Map<NetClient, ChatDelivered[]>(); const rejects = new Map<NetClient, number[]>();
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const connect = async (bot = false): Promise<NetClient> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; clients.push(c);
    inbox.set(c, []); rejects.set(c, []); c.chat.on((m) => inbox.get(c)!.push(m)); c.chat.onReject((_k, r) => rejects.get(c)!.push(r));
    if (bot) c.sendCommand(DevBotHello, { v: 1 });
    c.sendCommand(ClaimAccount, { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(4);
    return c;
  };
  const ent = (c: NetClient) => gs.players.get(c.clientId!)!.entity;
  const pid = (c: NetClient) => gs.world.getField(ent(c), PlayerId, "id")!;
  const place = (c: NetClient, x: number, y: number) => { gs.world.setField(ent(c), Transform, "x", x); gs.world.setField(ent(c), Transform, "y", y); };
  const texts = (c: NetClient) => inbox.get(c)!.map((m) => m.text);
  return { gs, tick, connect, pid, place, texts, inbox, rejects };
}

describe("server chat (ChatServer + core ChannelRegistry)", () => {
  it("local chat reaches only players within the local radius; global reaches everyone; mentions + emote ride along", async () => {
    const s = await setup({ chat: { localRadius: 10 } });
    const A = await s.connect(); const near = await s.connect(); const far = await s.connect();
    s.place(A, 0, 0); s.place(near, 6, 0); s.place(far, 40, 0); s.tick(2);
    A.chat.send(ChatChannel.Local, "hi nearby", { mentions: [s.pid(near)], emote: 3 }); A.chat.send(ChatChannel.Global, "hi all"); s.tick(4);
    expect(s.texts(near)).toEqual(["hi nearby", "hi all"]); expect(s.texts(far)).toEqual(["hi all"]); expect(s.texts(A)).toEqual(["hi nearby", "hi all"]);
    const m = s.inbox.get(near)![0]!; expect(m.mentions).toEqual([s.pid(near)]); expect(m.emote).toBe(3); expect(m.fromPlayer).toBe(s.pid(A));
  }, 20_000);

  it("party and clan chat are delivered to members only; non-members are rejected", async () => {
    const s = await setup();
    const A = await s.connect(); const B = await s.connect(); const C = await s.connect();
    const g = s.gs.permissions.groups;
    const party = g.create(GroupKind.Party).id; g.setRole(party, s.pid(A), GroupRole.Leader); g.setRole(party, s.pid(B), GroupRole.Member);
    const clan = g.create(GroupKind.Clan).id; g.setRole(clan, s.pid(A), GroupRole.Leader); g.setRole(clan, s.pid(C), GroupRole.Member);
    s.tick(3);
    A.chat.send(ChatChannel.Party, "party only"); A.chat.send(ChatChannel.Clan, "clan only"); C.chat.send(ChatChannel.Party, "intruder"); s.tick(4);
    expect(s.texts(B)).toEqual(["party only"]); expect(s.texts(C)).toEqual(["clan only"]); expect(s.texts(A)).toEqual(["party only", "clan only"]);
    expect(s.rejects.get(C)).toEqual([ChatReject.NotMember]);
  }, 20_000);

  it("rate limit: a burst past the bucket is rejected, then refills", async () => {
    const s = await setup({ chat: { rate: { capacity: 3, refillPerTick: 0.05 } } });
    const A = await s.connect(); const B = await s.connect();
    for (let i = 0; i < 5; i++) A.chat.send(ChatChannel.Global, `m${i}`); s.tick(3);
    expect(s.texts(B)).toEqual(["m0", "m1", "m2"]); expect(s.rejects.get(A)).toEqual([ChatReject.RateLimited, ChatReject.RateLimited]);
    s.tick(40); A.chat.send(ChatChannel.Global, "later"); s.tick(3); expect(s.texts(B).at(-1)).toBe("later");
  }, 20_000);

  it("bot chat is delivered through the same ChatServer", async () => {
    const s = await setup();
    const human = await s.connect(); const bot = await s.connect(true);
    expect(s.gs.players.get(bot.clientId!)!.bot).toBe(true);
    bot.chat.send(ChatChannel.Local, "hello survivor"); s.tick(4);
    expect(s.texts(human)).toEqual(["hello survivor"]); expect(s.texts(bot)).toEqual(["hello survivor"]); expect(s.gs.chat.stats.delivered).toBe(2);
  }, 20_000);
});
