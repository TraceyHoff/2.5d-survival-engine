import { describe, expect, it } from "vitest";
import { idleOutput, installPermissions, Membership, PlayerId, type AgentContext, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

function setup() {
  const w = makeWorld(); installPermissions(w);
  const mk = (i: number, x: number) => { const e = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: i }); w.add(e, PlayerId, { id: i }).add(e, Membership, { partyId: 0, clanId: 0 }); return e; };
  const agent = G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1);
  return { w, a: mk(1, 0), b: mk(2, 3), agent };
}
const ctx = (w: World, p: Entity, agent: ReturnType<typeof setup>["agent"]): AgentContext<G.AgentWorldView> => {
  const v = G.buildAgentView(w, p, agent, { x: 0, y: 0 })!; return { ...v, bb: agent.bb, memory: agent.memory, traits: agent.identity.traits, rng: agent.rng, agent };
};
const run = (name: string, c: AgentContext<G.AgentWorldView>) => { const o = idleOutput(); G.partyBehaviors().find((b) => b.name === name)!.run(c, o); return o; };
const T = (s: number, b = 0.5) => ({ bravery: b, sociability: s, greed: 0.5, industriousness: 0.5, chattiness: 0.5 });

describe("party behaviors", () => {
  it("accept chance rises with sociability, trust and need, falls with bravery; clamped", () => {
    expect(G.partyAcceptChance(T(0.9), 0, 0)).toBeGreaterThan(G.partyAcceptChance(T(0.1), 0, 0));
    expect(G.partyAcceptChance(T(0.5), 1, 0)).toBeGreaterThan(G.partyAcceptChance(T(0.5), -1, 0));
    expect(G.partyAcceptChance(T(0.5), 0, 1)).toBeGreaterThan(G.partyAcceptChance(T(0.5), 0, 0));
    expect(G.partyAcceptChance(T(0.5, 1), 0, 0)).toBeLessThan(G.partyAcceptChance(T(0.5, 0), 0, 0));
    expect(G.partyAcceptChance(T(1, 0), 5, 1)).toBe(1); expect(G.partyAcceptChance(T(0, 1), -5, 0)).toBe(0);
  });
  it("invite sensor -> accept/decline command with a cute line; partyless sensor -> invite command", () => {
    const { w, a, b, agent } = setup(); agent.identity.traits = T(1, 0); agent.identity.relationship = 1;
    const cb = ctx(w, b, agent); expect(cb.world.partyless?.map((x) => x.id)).toEqual([a]);
    const inv = run("party_invite", cb); expect(inv.actions).toEqual([`pinvite:${a}`]); expect(inv.chat?.text).toBeTruthy();
    expect(G.emitAgentCommands(inv).commands).toEqual([{ type: "gameplay.partyInvite", payload: { target: a } }]);
    G.partyInvite(w, a, b); const pid = G.partyOf(w, 1);
    const c = ctx(w, b, agent); expect(c.world.partyInvite).toMatchObject({ party: pid, from: 1 });
    const o = run("party_decide", c); expect(o.actions).toEqual([`paccept:${pid}`]); // chance 1
    expect(G.emitAgentCommands(o).commands).toEqual([{ type: "gameplay.partyAccept", payload: { party: pid } }]);
    agent.identity.traits = T(0, 1); agent.identity.relationship = -1; expect(run("party_decide", ctx(w, b, agent)).actions).toEqual([`pdecline:${pid}`]);
    G.partyAccept(w, b, pid); expect(w.has(b, G.PartyInvitePending)).toBe(false); expect(ctx(w, b, agent).world.partyId).toBe(pid);
  });
  it("low-sociability bots don't invite; leave fires after being alone long enough", () => {
    const { w, a, b, agent } = setup(); agent.identity.traits = T(0.1);
    const inviteBeh = G.partyBehaviors().find((x) => x.name === "party_invite")!;
    expect(inviteBeh.considerations[0]!.input(ctx(w, b, agent))).toBe(0);
    G.partyInvite(w, a, b); G.partyAccept(w, b, G.partyOf(w, 1));
    const leave = G.partyBehaviors().find((x) => x.name === "party_leave")!.considerations[0]!;
    const far = (t: number) => { const c = ctx(w, b, agent); return leave.input({ ...c, world: { ...c.world, partyMates: [] }, self: { ...c.self, tick: t } }); };
    expect(far(0)).toBe(0); expect(far(10)).toBe(0); expect(far(G.PARTY_AI.leaveAfterAlone * 2)).toBe(1);
    expect(run("party_leave", ctx(w, b, agent)).actions).toEqual(["pleave"]);
  });
});
