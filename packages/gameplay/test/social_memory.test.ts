import { describe, expect, it } from "vitest";
import { installPermissions, Membership, PlayerId, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

function setup() {
  const w = makeWorld(); installPermissions(w); G.installEconomy(w);
  const mk = (i: number, x: number) => { const e = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: i }); w.add(e, PlayerId, { id: i }).add(e, Membership, { partyId: 0, clanId: 0 }); return e; };
  return { w, a: mk(1, 0), b: mk(2, 3), agent: G.makeAgent(G.makeAgentIdentity(5, 0, "bot_gatherer"), 1) };
}
const view = (s: ReturnType<typeof setup>, e: Entity) => G.buildAgentView(s.w, e, s.agent, { x: 0, y: 0 })!;

describe("bot social memory (AgentIdentity.social)", () => {
  it("records party + clan joins with per-player trust/affinity and notable events", () => {
    const s = setup(); const { w, a, b, agent } = s;
    view(s, b); expect(G.socialMemoryOf(agent)).toMatchObject({ relationships: {}, party: null, clan: null });
    G.partyInvite(w, a, b); const party = G.partyOf(w, 1); G.partyAccept(w, b, party); view(s, b);
    const m = G.socialMemoryOf(agent); expect(m.party).toMatchObject({ id: party });
    expect(m.relationships["1"]).toMatchObject({ trust: G.SOCIAL_EVENTS.partied.trust, affinity: G.SOCIAL_EVENTS.partied.affinity, notableEvents: [{ kind: "partied" }] });
    G.clanCreate(w, a); const clan = G.clanOf(w, 1); G.clanInvite(w, a, b); G.clanAccept(w, b, clan); view(s, b);
    expect(m.clan).toMatchObject({ id: clan, role: 1 }); expect(m.relationships["1"]!.notableEvents.map((e) => e.kind)).toEqual(["partied", "clanmate"]);
    G.partyLeave(w, b); view(s, b); expect(m.party).toBeNull();
    for (let i = 0; i < 20; i++) G.noteSocialEvent(agent, 1, "attacked", 100 + i);
    expect(m.relationships["1"]!.trust).toBe(-1); expect(m.relationships["1"]!.notableEvents.length).toBe(G.SOCIAL_MEMORY.maxEvents);
    expect(G.trustOf(agent, 1)).toBe(-1); agent.identity.relationship = 0.7; expect(G.trustOf(agent, 99)).toBe(0.7); // unknown -> legacy scalar
  });
  it("invite decisions use remembered trust of the inviter", () => {
    const s = setup(); const { w, a, b, agent } = s; agent.identity.traits = { bravery: 0, sociability: 0.5, greed: 0.5, industriousness: 0.5, chattiness: 0.5 };
    G.partyInvite(w, a, b); const party = G.partyOf(w, 1); agent.identity.relationship = 1;
    for (let i = 0; i < 4; i++) G.noteSocialEvent(agent, 1, "attacked", i);
    const v = view(s, b); const o = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, sprint: false, actions: [] as string[] };
    G.partyBehaviors().find((x) => x.name === "party_decide")!.run({ ...v, bb: agent.bb, memory: agent.memory, traits: agent.identity.traits, rng: agent.rng, agent }, o as never);
    expect(G.partyAcceptChance(agent.identity.traits, -1, 0)).toBeLessThan(G.partyAcceptChance(agent.identity.traits, 1, 0));
    expect(o.actions.length).toBe(1); expect(o.actions[0]).toMatch(new RegExp(`^p(accept|decline):${party}$`));
  });
  it("debounced write-through, force flush, and validation of stored records", () => {
    const { agent } = setup(); const puts: [string, unknown][] = []; const put: G.AgentPut = (id, p) => puts.push([id, p]);
    G.noteSocialEvent(agent, 4, "traded", 10); G.noteSocialEvent(agent, 4, "helped", 11);
    expect(G.flushSocialMemory([agent], put, 10 + G.SOCIAL_MEMORY.writeDebounceTicks - 1)).toEqual([]);
    expect(G.flushSocialMemory([agent], put, 10 + G.SOCIAL_MEMORY.writeDebounceTicks)).toEqual([agent.identity.id]); expect(puts.length).toBe(1);
    expect(G.flushSocialMemory([agent], put, 1e6)).toEqual([]); // clean: nothing to write
    G.noteSocialEvent(agent, 4, "kicked", 12); expect(G.flushSocialMemory([agent], put, 12, true)).toEqual([agent.identity.id]);
    const saved = JSON.parse(JSON.stringify(puts[1]![1])) as { social: G.SocialMemory };
    expect(saved.social.relationships["4"]!.notableEvents.map((e) => e.kind)).toEqual(["traded", "helped", "kicked"]);
    const back = G.makeAgent({ ...G.makeAgentIdentity(5, 0, "bot_gatherer"), ...saved } as never, 1);
    expect(G.socialMemoryOf(back)).toEqual(saved.social);
    const junk = G.makeAgent({ ...G.makeAgentIdentity(5, 0, "bot_gatherer"), social: { relationships: { x: 1, "7": { trust: 9, notableEvents: [{ kind: "nope" }] } }, party: { id: "z" } } } as never, 1);
    expect(G.socialMemoryOf(junk)).toEqual({ relationships: { "7": { trust: 1, affinity: 0, lastSeen: 0, notableEvents: [] } }, party: null, clan: null });
  });
});
