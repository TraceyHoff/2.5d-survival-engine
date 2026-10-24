import { describe, it, expect } from "vitest";
import { CommandRejected, Membership, NetId, PlayerId, World, type Entity } from "@engine/core";
import { ClanCreateCmd, ClanInviteCmd, ClanAcceptCmd, PartyInviteCmd, PartyAcceptCmd } from "@engine/gameplay";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { AccountAssigned, ClaimAccount, MemoryWorldStore, tokenToWords, wordsToToken } from "@engine/persist";
import { createGameServer, applyMoveInput, installDemoWorld, gameplayNet, rejectReasonCode, DEMO_COMMANDS, DEMO_EVENTS, DeleteMyProgressCmd, DELETE_PROGRESS_CONFIRM, ProgressDeleted } from "../src/main.js";
import { SPAWN } from "../src/game.js";

async function boot(store: MemoryWorldStore) {
  const net = new LoopbackNetwork(11);
  const gs = createGameServer({ transport: net.createServer(), spawnPoints: [SPAWN], store, seed: 21, autosaveSeconds: 1, playerSaveSeconds: 1 });
  const cs: NetClient[] = [];
  const tick = (n = 1): void => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(1 / 20); for (const c of cs) { c.world.step(1 / 20); c.pollEvents(Infinity); } } };
  const join = async (token?: string) => {
    const world = new World({ seed: 1 }); installDemoWorld(world, "client");
    const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS, sampleInput: () => ({ buttons: 0, aimX: 0, aimY: 0 }), applyInput: (w, e, cmd) => applyMoveInput(w, e, cmd) });
    let account = ""; c.onEvent(AccountAssigned, (p) => { account = wordsToToken(p); });
    let deleted = 0; c.onEvent(ProgressDeleted, () => { deleted++; });
    const p = c.connect(); await new Promise((r) => setTimeout(r, 0)); net.advance(100); await p; cs.push(c);
    c.sendCommand(ClaimAccount, token ? tokenToWords(token) : { t0: 0, t1: 0, t2: 0, t3: 0 }); tick(3);
    return { c, account: () => account, deleted: () => deleted, e: (): Entity => gs.players.get(c.clientId)!.entity };
  };
  return { gs, tick, join };
}
const netIdOf = (gs: { world: World }, e: Entity): number => gs.world.getField(e, NetId, "id") ?? 0;

describe("account.deleteMyProgress (ADR-099)", () => {
  it("deletes only the caller's row, hands clan leadership on, and the next join is a fresh character", async () => {
    const store = new MemoryWorldStore();
    const r = await boot(store); const a = await r.join(), b = await r.join();
    const rj: string[] = []; r.gs.world.events.on(CommandRejected, (x) => { rj.push(`${x.command}:${x.reason}`); });
    a.c.sendCommand(gameplayNet(ClanCreateCmd), {}); r.tick(40);
    a.c.sendCommand(gameplayNet(ClanInviteCmd), { target: a.c.entities.get(netIdOf(r.gs, b.e()))! }); r.tick(40);
    const clan = r.gs.world.getField(a.e(), Membership, "clanId")!; b.c.sendCommand(gameplayNet(ClanAcceptCmd), { clan }); r.tick(40);
    a.c.sendCommand(gameplayNet(PartyInviteCmd), { target: a.c.entities.get(netIdOf(r.gs, b.e()))! }); r.tick(40);
    b.c.sendCommand(gameplayNet(PartyAcceptCmd), { party: r.gs.world.getField(a.e(), Membership, "partyId")! }); r.tick(40);
    expect(rj).toEqual([]);
    const ida = r.gs.world.getField(a.e(), PlayerId, "id")!, idb = r.gs.world.getField(b.e(), PlayerId, "id")!;
    r.tick(40); await store.flush();
    const ta = a.account(), tb = b.account(); expect(store.readPlayer(ta)).toBeDefined(); expect(store.readPlayer(tb)).toBeDefined();
    const bBefore = [...store.readPlayer(tb)!.bytes];

    // wrong confirm word -> rejected, nothing deleted
    const codes: number[] = []; b.c.onCommandRejected((x) => codes.push(x.reason));
    b.c.sendCommand(gameplayNet(DeleteMyProgressCmd), { confirm: 1 }); r.tick(5);
    expect(codes).toEqual([rejectReasonCode("bad_confirm")]); expect(store.readPlayer(tb)).toBeDefined();

    a.c.sendCommand(gameplayNet(DeleteMyProgressCmd), { confirm: DELETE_PROGRESS_CONFIRM }); r.tick(3);
    expect(a.deleted()).toBe(1); expect(b.deleted()).toBe(0);
    await store.flush();
    expect(store.readPlayer(ta)).toBeUndefined();
    expect(store.readPlayer(tb)).toBeDefined();
    const g = r.gs.permissions.groups;
    expect(g.isMember(clan, ida)).toBe(false); expect(g.role(clan, idb)).toBe(3); // b is the new clan leader
    r.tick(60); // kicked
    expect(r.gs.players.has(a.c.clientId)).toBe(false); expect(r.gs.players.has(b.c.clientId)).toBe(true);
    await store.flush(); expect(store.readPlayer(ta)).toBeUndefined(); // the kick must not re-save it
    expect(bBefore.length).toBeGreaterThan(0);

    const a2 = await r.join(ta); r.tick(3);
    expect(r.gs.world.getField(a2.e(), PlayerId, "id")).not.toBe(ida); // fresh character for the same token
    expect(r.gs.world.get(a2.e(), Membership)).toMatchObject({ clanId: 0, partyId: 0 });
    expect(r.gs.world.getField(b.e(), Membership, "clanId")).toBe(clan);
  }, 60_000);
});
