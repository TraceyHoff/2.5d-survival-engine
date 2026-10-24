import { describe, expect, it } from "vitest";
import { idleOutput, installPermissions, Membership, PlayerId, type AgentContext, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import en from "../data/locale/en.json";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const PLANK = d.itemId("planks");
function setup() {
  const w = makeWorld(); installPermissions(w); G.installEconomy(w);
  const mk = (i: number, x: number) => { const e = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: i }); w.add(e, PlayerId, { id: i }).add(e, Membership, { partyId: 0, clanId: 0 }); return e; };
  const agent = G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1);
  return { w, a: mk(1, 0), b: mk(2, 3), agent };
}
const ctx = (w: World, p: Entity, agent: ReturnType<typeof setup>["agent"], tick?: number): AgentContext<G.AgentWorldView> => {
  const v = G.buildAgentView(w, p, agent, { x: 0, y: 0 })!; return { ...v, self: { ...v.self, tick: tick ?? v.self.tick }, bb: agent.bb, memory: agent.memory, traits: agent.identity.traits, rng: agent.rng, agent };
};
const beh = (n: string) => G.clanBehaviors().find((b) => b.name === n)!;
const run = (n: string, c: AgentContext<G.AgentWorldView>) => { const o = idleOutput(); beh(n).run(c, o); return o; };
const want = (n: string, c: AgentContext<G.AgentWorldView>) => beh(n).considerations[0]!.input(c);
const T = (s: number, ind = 0.5, greed = 0.5, brave = 0.5) => ({ bravery: brave, sociability: s, greed, industriousness: ind, chattiness: 0.5 });
const snap = (w: World, key: string, x = 1, y = 1) => { const sn = G.snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`); return sn; };

describe("clan behaviors", () => {
  it("founding needs sociability + industriousness/greed; invite/accept round trip through emitAgentCommands", () => {
    const { w, a, b, agent } = setup();
    agent.identity.traits = T(0.2, 0.3, 0.3); expect(want("clan_found", ctx(w, a, agent))).toBe(0);
    agent.identity.traits = T(0.9, 0.9); const f = run("clan_found", ctx(w, a, agent));
    expect(G.emitAgentCommands(f).commands).toEqual([{ type: "gameplay.clanCreate", payload: {} }]); expect(f.chat?.text).toBeTruthy();
    G.clanCreate(w, a); const clan = G.clanOf(w, 1);
    const ca = ctx(w, a, agent); expect(ca.world.clan).toMatchObject({ id: clan, role: 3 }); expect(ca.world.clanless?.map((x) => x.id)).toEqual([b]);
    expect(want("clan_found", ca)).toBe(0); expect(want("clan_recruit", ca)).toBe(1);
    const r = run("clan_recruit", ca); expect(G.emitAgentCommands(r).commands).toEqual([{ type: "gameplay.clanInvite", payload: { target: b } }]);
    G.clanInvite(w, a, b); agent.identity.relationship = 1;
    const cb = ctx(w, b, agent); expect(cb.world.clanInvite).toMatchObject({ clan, from: 1 });
    const acc = run("clan_decide", cb); expect(G.emitAgentCommands(acc).commands).toEqual([{ type: "gameplay.clanAccept", payload: { clan } }]);
    expect(G.clanAcceptChance(T(0, 0), -1)).toBe(0); expect(G.clanAcceptChance(T(1, 1), 1)).toBe(1);
  });
  it("leader manages: rank perms once, promotes contributors, kicks long-idle members, sets goals", () => {
    const { w, a, b, agent } = setup(); agent.identity.traits = T(0.5, 0.9);
    G.clanCreate(w, a); const clan = G.clanOf(w, 1); G.clanInvite(w, a, b); G.clanAccept(w, b, clan);
    const o1 = G.emitAgentCommands(run("clan_manage", ctx(w, a, agent, 0)));
    expect(o1.commands?.map((c) => c.type)).toEqual(["gameplay.clanSetRankPerms", "gameplay.clanSetGoal"]);
    expect(o1.commands![1]!.payload).toEqual({ goal: G.ClanGoal.BuildBase, x: 0, y: 0 });
    G.clanSetGoal(w, a, G.ClanGoal.BuildBase, 0, 0);
    // idle member: tracked, then kicked after kickIdleTicks
    run("clan_manage", ctx(w, a, agent, 100));
    const k = run("clan_manage", ctx(w, a, agent, 100 + G.CLAN_AI.kickIdleTicks * 2)); expect(k.actions).toEqual([`ckick:${b}`]);
    // contributor: promoted
    w.setField(b, G.ClanStatus, "contrib", G.CLAN_AI.promoteContrib);
    expect(G.emitAgentCommands(run("clan_manage", ctx(w, a, agent, 1e6))).commands).toEqual([{ type: "gameplay.clanPromote", payload: { target: b } }]);
  });
  it("goal choice: defend on threats, raid when brave+greedy, stock once a stall exists, else base", () => {
    const base = { x: 1, y: 2 };
    expect(G.chooseClanGoal(T(0.5), { threats: 3, hasStall: true, base, current: 0 }).goal).toBe(G.ClanGoal.Defend);
    expect(G.chooseClanGoal(T(0.5, 0.5, 0.9, 0.9), { threats: 0, rival: { x: 9, y: 9 }, hasStall: false, base, current: 0 })).toEqual({ goal: G.ClanGoal.Raid, x: 9, y: 9 });
    expect(G.chooseClanGoal(T(0.5, 0.5, 0.2, 0.9), { threats: 0, rival: { x: 9, y: 9 }, hasStall: true, base, current: 0 }).goal).toBe(G.ClanGoal.StockStalls);
    expect(G.chooseClanGoal(T(0.5), { threats: 0, hasStall: false, base, current: 0 })).toEqual({ goal: G.ClanGoal.BuildBase, ...base });
  });
  it("members walk to the goal and stock clan stalls (contribution counted)", async () => {
    const { w, a, b, agent } = setup(); agent.identity.traits = T(0.5, 0.9);
    G.clanCreate(w, a); const clan = G.clanOf(w, 1); G.clanInvite(w, a, b); G.clanAccept(w, b, clan);
    G.clanSetGoal(w, a, G.ClanGoal.Defend, 20, 0);
    const g = ctx(w, b, agent); expect(want("clan_goal", g)).toBe(1); const mv = idleOutput(); beh("clan_goal").run(g, mv); expect(mv.moveX).toBeGreaterThan(0);
    const st = G.stallOf(w, G.placePiece(w, a, snap(w, "stall_booth", 1, 1), { pay: false }))!; G.setStallOwnership(w, st, G.tillOf(w, st), G.StallOwnerKind.Clan, clan);
    G.addItem(w, a, PLANK, 2); expect(G.stockStall(w, a, st, 0, G.listSlots(w, a).find((x) => x.item === PLANK)!.slot, 2)).toBeUndefined(); G.setListing(w, a, st, 0, { priceItem: PLANK, priceCount: 1, qty: 1, enabled: 1 });
    G.addItem(w, b, PLANK, 4); G.syncGameplayStallDisplay(w, st);
    const c = ctx(w, b, agent); expect(c.world.clanStock).toMatchObject({ stall: st, listing: 0, count: G.countItem(w, b, PLANK) });
    const o = G.emitAgentCommands(run("clan_stock", c)); const cmd = o.commands?.[0];
    expect(cmd?.type).toBe("gameplay.stockStall");
    const p = cmd!.payload as { stall: number; listingSlot: number; invSlot: number; count: number };
    expect(G.stockStall(w, b, p.stall, p.listingSlot, p.invSlot, p.count)).toBeUndefined(); expect(w.getField(b, G.ClanStatus, "contrib")).toBe(p.count);
  });
  it("social.clan.* lines exist for every situation", () => {
    for (const s of ["found", "invite", "accept", "decline", "promote", "kick", "goal", "contribute", "defend", "raid"] as const) {
      expect(Object.keys(en).some((k) => k.startsWith(`social.clan.${s}.`)), s).toBe(true); expect(G.clanLine(s, () => 0)?.text).toBeTruthy();
    }
  });
});
