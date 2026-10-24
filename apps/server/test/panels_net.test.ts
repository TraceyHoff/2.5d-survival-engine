import { describe, it, expect } from "vitest";
import { GroupKind, Membership, NetId, PlayerId, Transform, World, type Entity } from "@engine/core";
import { ChatChannel, LoopbackNetwork, NetClient, type ChatDelivered } from "@engine/net";
import { AccountAssigned, ClaimAccount, MemoryWorldStore, tokenToWords, wordsToToken } from "@engine/persist";
import { ClanAcceptCmd, ClanCreateCmd, ClanDeclineCmd, ClanDisbandCmd, ClanInviteCmd, ClanKickCmd, ClanLeaveCmd, ClanSetRankPermsCmd, ClanPromoteCmd, ClanInvitePending, GAMEPLAY_COMMANDS, IntentAction, PaintCmd, PlayerIntent, UseCmd } from "@engine/gameplay";
import { createGameServer, applyMoveInput, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";
import { CHAT_STYLE_RATE, ClanRoster, ClanRosterMember, GAMEPLAY_NET_COMMANDS, gameplayNet, OnlinePlayer, onGameplayRejected } from "../src/protocol.js";

type Roster = { clan: number; masks: [number, number]; rows: Map<number, { role: number; online: number }>; events: number };
async function setup() {
  const net = new LoopbackNetwork(7);
  const gs = createGameServer({ transport: net.createServer(), store: new MemoryWorldStore(), seed: 5, population: false });
  const clients: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of clients) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const roster = new Map<NetClient, Roster>(); const dir = new Map<NetClient, Set<number>>(); const chat = new Map<NetClient, ChatDelivered[]>(); const rej = new Map<NetClient, string[]>();
  const accounts = new Map<NetClient, string>();
  const connect = async (x = 16, y = 16, token?: string): Promise<NetClient> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    const r: Roster = { clan: 0, masks: [0, 0], rows: new Map(), events: 0 }; roster.set(c, r); dir.set(c, new Set()); chat.set(c, []); rej.set(c, []);
    c.onEvent(ClanRoster, (p) => { r.events++; if (p.clan !== r.clan) r.rows.clear(); r.clan = p.clan; r.masks = [p.memberMask, p.officerMask]; });
    c.onEvent(ClanRosterMember, (p) => { r.events++; if (p.clan !== r.clan) return; if (p.role) r.rows.set(p.player, { role: p.role, online: p.online }); else r.rows.delete(p.player); });
    c.onEvent(OnlinePlayer, (p) => { if (p.online) dir.get(c)!.add(p.player); else dir.get(c)!.delete(p.player); });
    c.chat.on((m) => chat.get(c)!.push(m)); c.onEvent(AccountAssigned, (p) => { accounts.set(c, wordsToToken(p)); }); onGameplayRejected(c, (x) => rej.get(c)!.push(x.reason));
    const p = c.connect(); await new Promise((res) => setTimeout(res, 0)); net.advance(100); await p; clients.push(c);
    c.sendCommand(ClaimAccount, token ? tokenToWords(token) : { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(2);
    gs.world.setField(ent(c), Transform, "x", x); gs.world.setField(ent(c), Transform, "y", y); tick(4);
    return c;
  };
  const ent = (c: NetClient): Entity => gs.players.get(c.clientId!)!.entity;
  const pid = (c: NetClient): number => gs.world.getField(ent(c), PlayerId, "id")!;
  const local = (by: NetClient, of: NetClient): Entity => by.entities.get(gs.world.getField(ent(of), NetId, "id") ?? 0)!;
  return { accounts, gs, net, tick, connect, ent, pid, roster, dir, chat, rej, clients, local };
}
/** Clan via gameplay commands sent by the server-side actor (same handlers the wire uses). */
function cmd(s: Awaited<ReturnType<typeof setup>>, c: NetClient, def: { name: string }, values: Record<string, number>): void {

  c.sendCommand(gameplayNet(def as never), values as never);
}

describe("gameplay.paint on the wire", () => {
  it("is appended once after the clan commands, Use-rate, NetId target, intent-queue path only", () => {
    const names = DEMO_COMMANDS.map((d) => d.name);
    expect(names.indexOf("gameplay.paint")).toBe(names.indexOf("gameplay.clanSetGoal") + 1);
    expect(names.indexOf("gameplay.clanDecline")).toBe(names.indexOf("gameplay.paint") + 1);
    const m = GAMEPLAY_NET_COMMANDS.filter((c) => c.core === PaintCmd); expect(m.length).toBe(1);
    const use = GAMEPLAY_NET_COMMANDS.find((c) => c.core === UseCmd)!;
    expect(m[0]!.net.rate).toEqual(use.net.rate); expect(m[0]!.net.entityFields).toEqual(["target"]);
    expect(GAMEPLAY_COMMANDS.some(([d]) => d === PaintCmd)).toBe(true); // -> queueCommand, never handlers.enqueue
  });
  it("a target in the sender's AOI reaches the intent queue once; an out-of-AOI NetId is dropped", async () => {
    const s = await setup(); const A = await s.connect();
    const near = s.gs.world.create(); s.gs.world.add(near, Transform, { x: 17, y: 16 }); s.gs.net.netIds.assign(near);
    const far = s.gs.world.create(); s.gs.world.add(far, Transform, { x: 4000, y: 4000 }); const farId = s.gs.net.netIds.assign(far);
    s.tick(6);
    const seen: number[] = []; s.gs.world.addSystem("input", "test.paintProbe", (w) => { const a = w.get(s.ent(A), PlayerIntent)?.action; if (a) seen.push(a); });
    const nearLocal = A.entities.get(s.gs.world.getField(near, NetId, "id")!)!; expect(nearLocal).toBeDefined();
    A.sendCommand(gameplayNet(PaintCmd), { target: nearLocal, paint: 3 }); s.tick(6);
    expect(seen.filter((a) => a === IntentAction.Paint).length).toBe(1);
    const dropped = (): number => s.gs.net.sessions.get(A.clientId!)!.stats.droppedCommands; const before = dropped();
    const fake = 0x7ffffff0 as Entity; (A as unknown as { netOf: Map<Entity, number> }).netOf.set(fake, farId);
    A.sendCommand(gameplayNet(PaintCmd), { target: fake, paint: 1 }); s.tick(6);
    expect(dropped()).toBe(before + 1); expect(seen.filter((a) => a === IntentAction.Paint).length).toBe(1);
  }, 20_000);
});

describe("clan roster replication (owner scope, members only)", () => {
  it("non-members never receive it; far members do; updates on join/promote/perms/leave/kick/disband", async () => {
    const s = await setup(); const A = await s.connect(16, 16); const B = await s.connect(18, 16); const far = await s.connect(3000, 3000); const X = await s.connect(17, 16);
    const R = (c: NetClient) => s.roster.get(c)!;
    cmd(s, A, ClanCreateCmd, {}); s.tick(3);
    const clan = s.gs.world.getField(s.ent(A), Membership, "clanId")!; expect(clan).toBeGreaterThan(0);
    expect(R(A).clan).toBe(clan); expect([...R(A).rows.keys()]).toEqual([s.pid(A)]);
    cmd(s, A, ClanInviteCmd, { target: s.local(A, B) }); s.tick(3); cmd(s, B, ClanAcceptCmd, { clan }); s.tick(3);
    // far member: invited via the registry directly (out of A's AOI), picked up by the per-tick diff
    s.gs.permissions.groups.addMember(clan, s.pid(far), 1); s.tick(3);
    for (const c of [A, B, far]) { expect(R(c).clan).toBe(clan); expect([...R(c).rows.keys()].sort()).toEqual([s.pid(A), s.pid(B), s.pid(far)].sort()); }
    expect(R(far).rows.get(s.pid(A))).toEqual({ role: 3, online: 1 });
    cmd(s, A, ClanPromoteCmd, { target: s.local(A, B) }); s.tick(3); expect(R(far).rows.get(s.pid(B))!.role).toBe(2);
    cmd(s, A, ClanSetRankPermsCmd, { role: 1, mask: 0 }); s.tick(3); expect(R(far).masks[0]).toBe(0); expect(R(B).masks[0]).toBe(0);
    // leave: B gets a clear, then nothing
    cmd(s, B, ClanLeaveCmd, {}); s.tick(3); expect(R(B).clan).toBe(0); expect(R(A).rows.has(s.pid(B))).toBe(false); expect(R(far).rows.has(s.pid(B))).toBe(false);
    const bEvents = R(B).events; cmd(s, A, ClanSetRankPermsCmd, { role: 1, mask: 1 }); s.tick(3); expect(R(B).events).toBe(bEvents);
    // kick (A leader kicks far, by NetId: far is outside A's AOI, so use the registry path like a server tool would)
    s.gs.permissions.groups.addMember(clan, s.pid(B), 1); s.tick(3); expect(R(B).clan).toBe(clan);
    cmd(s, A, ClanKickCmd, { target: s.local(A, B) }); s.tick(3); expect(R(B).clan).toBe(0); expect(R(far).rows.has(s.pid(B))).toBe(false);
    // disband: everyone cleared
    cmd(s, A, ClanDisbandCmd, {}); s.tick(3); expect(R(A).clan).toBe(0); expect(R(far).clan).toBe(0); expect(R(far).rows.size).toBe(0);
    expect(R(X).events).toBe(0); // never a member: never received anything
  }, 30_000);
  it("bounded: one row per member on join, deltas after", async () => {
    const s = await setup(); const A = await s.connect(); const B = await s.connect(17, 16);
    cmd(s, A, ClanCreateCmd, {}); s.tick(3); const clan = s.gs.world.getField(s.ent(A), Membership, "clanId")!;
    s.gs.permissions.groups.addMember(clan, s.pid(B), 1); s.tick(3);
    const e0 = s.roster.get(A)!.events; s.tick(20); expect(s.roster.get(A)!.events).toBe(e0); // idle: nothing re-sent
    expect(s.roster.get(B)!.events).toBe(3); // header + 2 member rows
  }, 20_000);
});

describe("gameplay.clanDecline", () => {
  it("chat-style rate; drops the pending invite; second decline is no_invite", async () => {
    expect(GAMEPLAY_NET_COMMANDS.find((c) => c.core === ClanDeclineCmd)!.net.rate).toEqual(CHAT_STYLE_RATE);
    const s = await setup(); const A = await s.connect(); const B = await s.connect(17, 16);
    cmd(s, A, ClanCreateCmd, {}); s.tick(3); const clan = s.gs.world.getField(s.ent(A), Membership, "clanId")!;
    cmd(s, A, ClanInviteCmd, { target: s.local(A, B) }); s.tick(3); expect(s.gs.world.has(s.ent(B), ClanInvitePending)).toBe(true);
    cmd(s, B, ClanDeclineCmd, { clan }); s.tick(3); expect(s.gs.world.has(s.ent(B), ClanInvitePending)).toBe(false); expect(s.rej.get(B)).toEqual([]);
    cmd(s, B, ClanDeclineCmd, { clan }); s.tick(3); expect(s.rej.get(B)).toEqual(["no_invite"]);
    cmd(s, B, ClanAcceptCmd, { clan }); s.tick(3); expect(s.rej.get(B)).toEqual(["no_invite", "no_invite"]);
  }, 20_000);
});

describe("online directory + chat replay", () => {
  it("directory: full list on claim, deltas on join/leave", async () => {
    const s = await setup(); const A = await s.connect(); const B = await s.connect();
    expect([...s.dir.get(A)!].sort()).toEqual([s.pid(A), s.pid(B)].sort()); expect(s.dir.get(B)!.size).toBe(2);
    const bId = s.pid(B); B.close(); s.tick(6); expect(s.dir.get(A)!.has(bId)).toBe(false);
  }, 20_000);
  it("replays global + own party/clan/whispers on join, never other groups' lines", async () => {
    const s = await setup(); const A = await s.connect(); const B = await s.connect(); const C = await s.connect();
    const g = s.gs.permissions.groups;
    const clanAB = g.create(GroupKind.Clan).id; g.setRole(clanAB, s.pid(A), 3); g.setRole(clanAB, s.pid(B), 1);
    const party = g.create(GroupKind.Party).id; g.setRole(party, s.pid(A), 3); g.setRole(party, s.pid(B), 1); s.tick(2);
    A.chat.send(ChatChannel.Global, "g1"); A.chat.send(ChatChannel.Clan, "clan-ab"); A.chat.send(ChatChannel.Party, "party-ab");
    A.chat.send(ChatChannel.Whisper, "to-b", { to: s.pid(B) }); A.chat.send(ChatChannel.Whisper, "to-c", { to: s.pid(C) }); A.chat.send(ChatChannel.Local, "local"); s.tick(4);
    const texts = (c: NetClient) => s.chat.get(c)!.map((m) => m.text);
    const fresh = await s.connect(); expect(texts(fresh)).toEqual(["g1"]); // new player: global only
    const tb = s.accounts.get(B)!, tc = s.accounts.get(C)!; B.close(); C.close(); s.tick(4);
    const B2 = await s.connect(16, 16, tb); expect(texts(B2)).toEqual(["g1", "clan-ab", "party-ab", "to-b"]);
    const C2 = await s.connect(16, 16, tc); expect(texts(C2)).toEqual(["g1", "to-c"]); // no other clan/party lines
  }, 20_000);
});
