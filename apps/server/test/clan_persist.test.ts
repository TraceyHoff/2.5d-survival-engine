import { describe, it, expect } from "vitest";
import { CommandRejected, Membership, NetId, PlayerId, World, type Entity } from "@engine/core";
import { ClanCreateCmd, ClanInviteCmd, ClanAcceptCmd, ClanSetGoalCmd, ClanStatus, ClanGoal, PartyInviteCmd, PartyAcceptCmd, CLAN_COMMANDS, PARTY_COMMANDS, clanData } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { AccountAssigned, ClaimAccount, MemoryWorldStore, tokenToWords, wordsToToken } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, rejectReasonCode, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

async function boot(store: MemoryWorldStore) {
  const net = new LoopbackNetwork(11);
  const gs = createGameServer({ transport: net.createServer(), store, seed: 21, autosaveSeconds: 1, playerSaveSeconds: 1 });
  const cs: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of cs) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const join = async (token?: string): Promise<{ c: NetClient; account: () => string; e: () => Entity }> => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    let account = ""; c.onEvent(AccountAssigned, (p) => { account = wordsToToken(p); });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; cs.push(c);
    c.sendCommand(ClaimAccount, token ? tokenToWords(token) : { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    return { c, account: () => account, e: () => gs.players.get(c.clientId)!.entity };
  };
  return { gs, tick, join };
}
const netIdOf = (gs: { world: World }, e: Entity): number => gs.world.getField(e, NetId, "id") ?? 0;

describe("clan commands over the net + persistence", () => {
  it("registers clan commands append-only after party with clear reject codes", async () => {
    const names = DEMO_COMMANDS.map((d) => d.name);
    expect(names.indexOf(CLAN_COMMANDS[0]!.name)).toBe(names.indexOf(PARTY_COMMANDS[PARTY_COMMANDS.length - 1]!.name) + 1);
    const { tick, join } = await boot(new MemoryWorldStore()); const a = await join();
    const got: number[] = []; a.c.onCommandRejected((r) => got.push(r.reason));
    a.c.sendCommand(gameplayNet(CLAN_COMMANDS[3]!), {}); tick(3); // clanLeave
    expect(got).toEqual([rejectReasonCode("not_in_clan")]); expect(got[0]).toBeGreaterThan(0);
  });
  it("ClanStatus reaches only the owner and clanmates; goal coordinates must be finite and in the world", async () => {
    const { gs, tick, join } = await boot(new MemoryWorldStore()); const a = await join(), b = await join(), x = await join();
    const rj: string[] = []; gs.world.events.on(CommandRejected, (r) => { rj.push(`${r.command}:${r.reason}`); });
    a.c.sendCommand(gameplayNet(ClanCreateCmd), {}); tick(3);
    a.c.sendCommand(gameplayNet(ClanInviteCmd), { target: a.c.entities.get(netIdOf(gs, b.e()))! }); tick(3);
    const clan = gs.world.getField(a.e(), Membership, "clanId")!; b.c.sendCommand(gameplayNet(ClanAcceptCmd), { clan }); tick(3);
    a.c.sendCommand(gameplayNet(ClanSetGoalCmd), { goal: ClanGoal.Raid, x: 7, y: 8 }); tick(5);
    expect(rj).toEqual([]);
    const seen = (c: NetClient, owner: Entity): boolean => { const l = c.entities.get(netIdOf(gs, owner)); return l !== undefined && c.world.has(l, ClanStatus); };
    expect(seen(a.c, a.e())).toBe(true); expect(seen(b.c, a.e())).toBe(true); expect(seen(a.c, b.e())).toBe(true);
    expect(x.c.entities.get(netIdOf(gs, a.e()))).toBeDefined(); // the non-member sees the player...
    expect(seen(x.c, a.e())).toBe(false); expect(seen(x.c, b.e())).toBe(false); // ...but not the clan goal / raid target
    for (const [px, py] of [[NaN, 0], [0, Infinity], [-Infinity, 0], [1e9, 0], [0, -40000]] as const) { a.c.sendCommand(gameplayNet(ClanSetGoalCmd), { goal: ClanGoal.Raid, x: px, y: py }); tick(40); }
    tick(5);
    expect(rj).toEqual(Array(5).fill("gameplay.clanSetGoal:bad_goal"));
    expect(clanData(gs.world, clan)).toMatchObject({ goal: ClanGoal.Raid, goalX: 7, goalY: 8 });
  });
  it("clan + party membership, clan goal and the base tribe survive a save and reload", async () => {
    const store = new MemoryWorldStore();
    const r1 = await boot(store); const a = await r1.join(), b = await r1.join();
    const rj: string[] = []; r1.gs.world.events.on(CommandRejected, (r) => { rj.push(`${r.command}:${r.reason}`); });
    a.c.sendCommand(gameplayNet(ClanCreateCmd), {}); r1.tick(3);
    a.c.sendCommand(gameplayNet(ClanInviteCmd), { target: a.c.entities.get(netIdOf(r1.gs, b.e()))! }); r1.tick(3);
    const clan = r1.gs.world.getField(a.e(), Membership, "clanId")!; expect(clan).toBeGreaterThan(0);
    b.c.sendCommand(gameplayNet(ClanAcceptCmd), { clan }); r1.tick(3);
    a.c.sendCommand(gameplayNet(ClanSetGoalCmd), { goal: ClanGoal.BuildBase, x: 3, y: 4 }); r1.tick(3);
    a.c.sendCommand(gameplayNet(PartyInviteCmd), { target: a.c.entities.get(netIdOf(r1.gs, b.e()))! }); r1.tick(3);
    const party = r1.gs.world.getField(a.e(), Membership, "partyId")!; b.c.sendCommand(gameplayNet(PartyAcceptCmd), { party }); r1.tick(3);
    expect(rj).toEqual([]); expect(r1.gs.world.get(b.e(), Membership)).toEqual({ partyId: party, clanId: clan });
    expect(r1.gs.world.get(b.e(), ClanStatus)).toMatchObject({ clan, role: 1, goal: ClanGoal.BuildBase });
    const ids = [a, b].map((x) => r1.gs.world.getField(x.e(), PlayerId, "id")!); const tokens = [a.account(), b.account()];
    r1.tick(40); await r1.gs.shutdown();

    const r2 = await boot(store);
    expect(clanData(r2.gs.world, clan)).toMatchObject({ goal: ClanGoal.BuildBase, goalX: 3, goalY: 4 });
    const g = r2.gs.permissions.groups; expect(g.role(clan, ids[0]!)).toBe(3); expect(g.role(clan, ids[1]!)).toBe(1); expect(g.isMember(party, ids[1]!)).toBe(true);
    const b2 = await r2.join(tokens[1]);
    expect(r2.gs.world.getField(b2.e(), PlayerId, "id")).toBe(ids[1]);
    expect(r2.gs.world.get(b2.e(), Membership)).toEqual({ partyId: party, clanId: clan });
    expect(r2.gs.world.get(b2.e(), ClanStatus)).toMatchObject({ clan, role: 1, goal: ClanGoal.BuildBase, goalX: 3, goalY: 4 });
  });
});
