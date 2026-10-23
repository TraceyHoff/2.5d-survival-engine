import { describe, expect, it } from "vitest";
import { GroupRole, installPermissions, Membership, Permissions, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

function setup(n = 4): { w: World; p: Entity[] } {
  const w = makeWorld(); installPermissions(w);
  const p = Array.from({ length: n }, (_, i) => { const e = G.spawnPlayer(w, { x: i, y: 0, maxWeight: 0, clientId: i + 1 }); w.add(e, PlayerId, { id: 100 + i }).add(e, Membership, { partyId: 0, clanId: 0 }); return e; });
  return { w, p };
}
const R = (w: World) => w.resource(Permissions).groups;
const party = (w: World, e: Entity) => w.getField(e, Membership, "partyId");

describe("party commands", () => {
  it("invite creates a party led by the inviter; accept joins and mirrors Membership", () => {
    const { w, p: [a, b] } = setup();
    expect(G.partyInvite(w, a!, b!)).toBeUndefined();
    const pid = G.partyOf(w, 100); expect(pid).toBeGreaterThan(0); expect(R(w).role(pid, 100)).toBe(GroupRole.Leader); expect(party(w, a!)).toBe(pid);
    expect(G.partyAccept(w, b!, pid)).toBeUndefined(); expect(R(w).role(pid, 101)).toBe(GroupRole.Member); expect(party(w, b!)).toBe(pid);
    expect(G.partyAccept(w, b!, pid)).toBe("in_party");
  });
  it("decline drops the invite", () => {
    const { w, p: [a, b] } = setup(); G.partyInvite(w, a!, b!); const pid = G.partyOf(w, 100);
    expect(G.partyDecline(w, b!, pid)).toBeUndefined(); expect(G.partyAccept(w, b!, pid)).toBe("no_invite"); expect(G.partyDecline(w, b!, pid)).toBe("no_invite");
  });
  it("clear reject reasons", () => {
    const { w, p: [a, b, c] } = setup();
    expect(G.partyInvite(w, a!, a!)).toBe("self");
    expect(G.partyInvite(w, a!, 9999)).toBe("no_target");
    expect(G.partyAccept(w, b!, 1)).toBe("no_invite");
    expect(G.partyLeave(w, b!)).toBe("not_in_party");
    G.partyInvite(w, a!, b!); const pid = G.partyOf(w, 100); G.partyAccept(w, b!, pid);
    expect(G.partyInvite(w, b!, c!)).toBe("not_officer"); // members can't invite
    expect(G.partyInvite(w, c!, b!)).toBe("in_party");
    expect(G.partyKick(w, b!, a!)).toBe("not_officer");
    expect(G.partyKick(w, a!, c!)).toBe("not_in_party");
    R(w).setRole(pid, 101, GroupRole.Officer); expect(G.partyKick(w, b!, a!)).toBe("outranked");
  });
  it("invites expire deterministically by tick and are refreshed by a repeat invite", () => {
    const { w, p: [a, b] } = setup(); G.partyInvite(w, a!, b!); const pid = G.partyOf(w, 100);
    w.tick += G.PARTY_RULES.inviteTicks; expect(G.partyAccept(w, b!, pid)).toBe("invite_expired");
    expect(G.partyAccept(w, b!, pid)).toBe("no_invite"); // pruned
    G.partyInvite(w, a!, b!); w.tick += G.PARTY_RULES.inviteTicks - 1; expect(G.partyAccept(w, b!, pid)).toBeUndefined();
  });
  it("full party, kick, and leader leave promotes highest role then lowest PlayerId; empty party is deleted", () => {
    const { w, p } = setup(G.PARTY_RULES.maxSize + 1); const [a, b, c, d] = p as [Entity, Entity, Entity, Entity];
    G.partyInvite(w, a, b); const pid = G.partyOf(w, 100);
    for (const e of p.slice(1, G.PARTY_RULES.maxSize)) { G.partyInvite(w, a, e); expect(G.partyAccept(w, e, pid)).toBeUndefined(); }
    expect(G.partyInvite(w, a, p[G.PARTY_RULES.maxSize]!)).toBe("party_full");
    expect(G.partyKick(w, a, d)).toBeUndefined(); expect(party(w, d)).toBe(0);
    R(w).setRole(pid, 102, GroupRole.Officer);
    expect(G.partyLeave(w, a)).toBeUndefined(); expect(R(w).role(pid, 102)).toBe(GroupRole.Leader); // officer c beats member b
    for (const e of p) if (G.partyOf(w, w.getField(e, PlayerId, "id")!)) G.partyLeave(w, e);
    expect(R(w).get(pid)).toBeUndefined(); void b; void c;
  });
});
