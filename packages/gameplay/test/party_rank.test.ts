import { describe, expect, it } from "vitest";
import { GroupRole, installPermissions, Membership, PlayerId, type Entity } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

describe("PartyRank mirror + partyView kick/invite gating (ADR-141)", () => {
  it("only the leader may kick/invite; leader handover updates the mirror", () => {
    const w = makeWorld(); installPermissions(w);
    const [a, b, c] = [0, 1, 2].map((i) => { const e = G.spawnPlayer(w, { x: i, y: 0, maxWeight: 0, clientId: i + 1 }); w.add(e, PlayerId, { id: 100 + i }).add(e, Membership, { partyId: 0, clanId: 0 }); return e; }) as [Entity, Entity, Entity];
    G.partyInvite(w, a, b); const pid = G.partyOf(w, 100); G.partyAccept(w, b, pid); G.partyInvite(w, a, c); G.partyAccept(w, c, pid);
    const rank = (e: Entity) => w.getField(e, G.PartyRank, "role") ?? 0;
    expect(rank(a)).toBe(GroupRole.Leader); expect(rank(b)).toBe(GroupRole.Member);
    const view = (me: Entity) => G.partyView({ world: w, player: me, names: new Map() } as never);
    const va = view(a), vb = view(b);
    expect(va.members.filter((m) => va.canKick(m)).map((m) => m.entity).sort()).toEqual([b, c].sort());
    expect(vb.members.some((m) => vb.canKick(m))).toBe(false); expect(vb.canInvite).toBe(false); expect(va.canInvite).toBe(true);
    G.partyLeave(w, a); expect(rank(a)).toBe(0); expect(rank(b)).toBe(GroupRole.Leader);
    const vb2 = view(b); expect(vb2.members.filter((m) => vb2.canKick(m)).map((m) => m.entity)).toEqual([c]);
  });
});
