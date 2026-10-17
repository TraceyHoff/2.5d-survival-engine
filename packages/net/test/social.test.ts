import { describe, expect, it } from "vitest";
import { defineComponent, Owner, Transform, type Entity } from "@engine/core";
import { ChannelRegistry, GroupRegistry } from "@engine/core";
import { CHUNK_SIZE } from "@engine/world";
import { ChatChannel, ChatReject, ChatServer, GroupKind, GroupReplicator, GroupRole, LoopbackNetwork, NetClient, NetServer, defineNetEvent, type ChatDelivered } from "../src/index.js";
import { frames, join, makeWorld } from "./fixture.js";

const Intel = defineComponent("Intel", { v: "u8" }, { networked: true });
const Ping = defineNetEvent("Ping", { n: "u8" });
const mk = () => { const w = makeWorld(); w.register(Intel); return w; };
const POS: Record<number, [number, number]> = { 1: [10, 10], 2: [20, 10], 3: [30, 10], 4: [10 + 20 * CHUNK_SIZE, 10] };

async function setup() {
  const net = new LoopbackNetwork(3); const sw = mk(); const groups = new GroupRegistry();
  const ents = new Map<number, Entity>();
  const server = new NetServer({ world: sw, transport: net.createServer(), events: [Ping], interest: { radius: 2, hysteresis: 0 },
    onClientJoin: (s, w) => { const e = w.create(); const [x, y] = POS[s.clientId]!; w.add(e, Transform, { x, y }).add(e, Owner, { clientId: s.clientId }).add(e, Intel, { v: s.clientId }); ents.set(s.clientId, e); } });
  server.setScope(Intel, "party");
  const rep = new GroupReplicator(server, { groups, markerHealth: () => 80 });
  const chat = new ChatServer(server, { channels: new ChannelRegistry(groups), localRadius: 48, maxLength: 40 });
  const party = groups.create(GroupKind.Party).id; groups.setRole(party, 1, GroupRole.Leader); groups.setRole(party, 2, GroupRole.Member);
  const clan = groups.create(GroupKind.Clan).id; groups.setRole(clan, 1, GroupRole.Leader); groups.setRole(clan, 3, GroupRole.Officer);
  const cs: NetClient[] = [];
  for (let i = 0; i < 4; i++) { const c = new NetClient({ world: mk(), transport: net.createClient({ latencyMs: 20 }), events: [Ping] }); await join(net, c); cs.push(c); }
  const step = (n = 1) => frames(net, [sw, ...cs.map((c) => c.world)], n);
  const inbox = cs.map(() => [] as ChatDelivered[]); cs.forEach((c, i) => c.chat.on((m) => inbox[i]!.push(m)));
  const rejects = cs.map(() => [] as number[]); cs.forEach((c, i) => c.chat.onReject((_ch, r) => rejects[i]!.push(r)));
  step(5);
  return { net, sw, server, groups, rep, chat, party, clan, cs, step, inbox, rejects, ents };
}
const who = (inbox: ChatDelivered[][], text: string) => inbox.map((l, i) => (l.some((m) => m.text === text) ? i + 1 : 0)).filter(Boolean);

describe("groups: rosters to affected members only, scopes, markers", () => {
  it("routes roster deltas to members, full roster to newcomers, delete to the removed", async () => {
    const { cs, groups, party, clan, step, rep } = await setup();
    const [A, B, C, D] = cs as [NetClient, NetClient, NetClient, NetClient];
    expect([...A.groups.groups.keys()].sort()).toEqual([party, clan]);
    expect([...B.groups.groups.keys()]).toEqual([party]);
    expect([...C.groups.groups.keys()]).toEqual([clan]);
    expect(D.groups.groups.size).toBe(0);
    groups.setRole(party, 4, GroupRole.Member); step(2);
    expect([...D.groups.groups.get(party)!.members.keys()].sort()).toEqual([1, 2, 4]);
    expect(A.groups.groups.get(party)!.members.has(4)).toBe(true);
    expect(C.groups.groups.has(party)).toBe(false); // never told about a party it is not in
    groups.setRole(party, 2, 0); step(2);
    expect(B.groups.groups.has(party)).toBe(false);
    expect([...A.groups.groups.get(party)!.members.keys()].sort()).toEqual([1, 4]);
    groups.setBanner(clan, { shape: 2, pattern: 5, colors: [0xff0000ff, 0x00ff00ff], emblemId: 300 }); step(2);
    expect(C.groups.groups.get(clan)!.banner).toEqual({ shape: 2, pattern: 5, colors: [0xff0000ff, 0x00ff00ff], emblemId: 300 });
    expect(B.groups.groups.has(clan)).toBe(false);
    groups.setRole(clan, 3, GroupRole.Leader); step(2);
    expect(C.groups.groups.get(clan)!.members.get(3)).toBe(GroupRole.Leader);
    expect(rep.stats.rosterBytes).toBeLessThan(400);
  });

  it("party scope component, group event scopes and member markers beyond AOI", async () => {
    const { cs, server, ents, step, groups, clan } = await setup();
    const [A, B, C, D] = cs as [NetClient, NetClient, NetClient, NetClient];
    const intelOf = (c: NetClient, owner: number) => { const e = c.entityOf(server.netIds.netIdOf(ents.get(owner)!)!); return e === undefined ? undefined : c.world.get(e, Intel); };
    expect(intelOf(B, 1)?.v).toBe(1); // party member sees A's Intel
    expect(intelOf(C, 1)).toBeUndefined(); // in AOI but not in A's party
    server.emitEvent(Ping, { n: 7 }, { scope: { groupOf: ents.get(1)!, kind: "clan" } }); step(3);
    const got = cs.map((c) => c.pollEvents(Infinity).length);
    expect(got).toEqual([1, 0, 1, 0]);
    // D (far away) joins the clan: A gets a marker for D at ~2 Hz, with gameplay health
    groups.setRole(clan, 4, GroupRole.Member); step(12);
    const m = A.groups.markers.get(4)!;
    expect(m).toBeDefined(); expect(Math.abs(m.x - POS[4]![0])).toBeLessThan(0.5); expect(m.hp).toBe(80);
    expect(A.groups.markers.has(3)).toBe(false); // C is inside A's AOI: replicated normally
    expect(D.groups.markers.get(1)).toBeDefined();
  });
});

describe("chat routing", () => {
  it("delivers per channel; non-members never receive party/clan messages", async () => {
    const { cs, step, inbox, rejects } = await setup();
    const [A, , C, D] = cs as [NetClient, NetClient, NetClient, NetClient];
    A.chat.send(ChatChannel.Party, "p1"); A.chat.send(ChatChannel.Clan, "c1"); A.chat.send(ChatChannel.Global, "g1");
    A.chat.send(ChatChannel.Local, "l1"); A.chat.send(ChatChannel.Whisper, "w1", { to: 3 });
    D.chat.send(ChatChannel.Party, "dp"); step(3);
    expect(who(inbox, "p1")).toEqual([1, 2]);
    expect(who(inbox, "c1")).toEqual([1, 3]);
    expect(who(inbox, "g1")).toEqual([1, 2, 3, 4]);
    expect(who(inbox, "l1")).toEqual([1, 2, 3]); // D is 640 tiles away
    expect(who(inbox, "w1")).toEqual([1, 3]);
    expect(who(inbox, "dp")).toEqual([]); expect(rejects[3]).toEqual([ChatReject.NotMember]);
    const m = inbox[2]!.find((x) => x.text === "c1")!; expect(m.fromPlayer).toBe(1); expect(m.channel).toBe(ChatChannel.Clan);
    C.chat.send(ChatChannel.System, "fake"); step(2); expect(rejects[2]).toEqual([ChatReject.BadChannel]);
  });
  it("enforces rate limit, max length, normalization, mute/filter and block hooks; system messages", async () => {
    const { cs, step, inbox, rejects, chat, server } = await setup();
    const [A, B] = cs as [NetClient, NetClient];
    for (let i = 0; i < 8; i++) A.chat.send(ChatChannel.Global, `spam${i}`);
    A.chat.send(ChatChannel.Global, "x".repeat(41)); step(2);
    expect(inbox[1]!.filter((m) => m.text.startsWith("spam")).length).toBe(5);
    expect(rejects[0]!.filter((r) => r === ChatReject.RateLimited).length).toBe(4); // 3 spam + the long one (no tokens)
    step(60); A.chat.send(ChatChannel.Global, "x".repeat(41)); step(2); expect(rejects[0]!.at(-1)).toBe(ChatReject.TooLong);
    A.chat.send(ChatChannel.Global, "  e\u0301  "); step(2); expect(inbox[1]!.at(-1)!.text).toBe("\u00e9");
    chat.channels.mutes.mute(2);
    chat.opts.filter = (_s, _c, t) => (t.includes("bad") ? null : t.replace("darn", "****"));
    chat.channels.mutes.block(3, 1);
    step(60);
    B.chat.send(ChatChannel.Global, "hi"); A.chat.send(ChatChannel.Global, "bad word"); A.chat.send(ChatChannel.Global, "darn it"); step(2);
    expect(rejects[1]!.at(-1)).toBe(ChatReject.Muted); expect(rejects[0]!.at(-1)).toBe(ChatReject.Filtered);
    expect(who(inbox, "**** it")).toEqual([1, 2, 4]); // C blocked A
    chat.system("server restarting", [2]); step(2);
    expect(who(inbox, "server restarting")).toEqual([2]); expect(inbox[1]!.at(-1)!.channel).toBe(ChatChannel.System);
    void server;
  });

  it("mentions are capped, filtered to online players and never used for delivery; emote id passes through", async () => {
    const { cs, step, inbox } = await setup();
    const [A] = cs as [NetClient];
    A.chat.send(ChatChannel.Party, "hey @C @ghost", { mentions: [3, 99, 3, 0, 2], emote: 42 }); step(3);
    expect(who(inbox, "hey @C @ghost")).toEqual([1, 2]); // C is mentioned but not in the party: not delivered
    const m = inbox[1]!.find((x) => x.text.startsWith("hey"))!;
    expect(m.mentions).toEqual([3, 2]); expect(m.emote).toBe(42);
    A.chat.send(ChatChannel.Global, "many", { mentions: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3] }); step(3);
    expect(inbox[3]!.find((x) => x.text === "many")!.mentions).toEqual([1, 2, 3, 4]);
  });
});
