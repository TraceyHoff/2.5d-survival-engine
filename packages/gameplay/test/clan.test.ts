import { describe, it, expect } from "vitest";
import { can, GroupKind, GroupRole, installPermissions, Membership, OwnedBy, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const PLANK = d.itemId("planks");
function setup() {
  const w = makeWorld(); const perms = installPermissions(w); G.installEconomy(w);
  const mk = (pid: number, x = 0) => { const p = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); return p; };
  return { w, perms, mk };
}
const snap = (w: World, key: string, x = 1, y = 1) => { const sn = G.snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`); return sn; };
const place = (w: World, b: Entity, key: string, x = 1, y = 1) => G.stallOf(w, G.placePiece(w, b, snap(w, key, x, y), { pay: false }))!;

describe("clan commands", () => {
  it("create / invite / accept / promote / demote / kick / leave with reasons and mirrored components", () => {
    const { w, perms, mk } = setup(); const A = mk(1), B = mk(2), C = mk(3);
    expect(G.clanInvite(w, A, B)).toBe("not_in_clan");
    expect(G.clanCreate(w, A)).toBeUndefined(); const clan = G.clanOf(w, 1);
    expect(perms.groups.get(clan)!.kind).toBe(GroupKind.Clan); expect(G.clanCreate(w, A)).toBe("in_clan");
    expect(w.get(A, G.ClanStatus)).toMatchObject({ clan, role: GroupRole.Leader }); expect(w.getField(A, G.Tribe, "id")).toBe(clan);
    expect(G.clanInvite(w, A, B)).toBeUndefined(); expect(w.get(B, G.ClanInvitePending)).toMatchObject({ clan, from: 1 });
    expect(G.clanAccept(w, B, clan)).toBeUndefined(); expect(w.has(B, G.ClanInvitePending)).toBe(false);
    expect(w.getField(B, Membership, "clanId")).toBe(clan); expect(w.getField(B, G.Tribe, "id")).toBe(clan);
    expect(G.clanInvite(w, B, C)).toBe("no_permission"); // members can't invite by default
    expect(G.clanPromote(w, B, A)).toBe("not_leader");
    expect(G.clanPromote(w, A, B)).toBeUndefined(); expect(perms.groups.role(clan, 2)).toBe(GroupRole.Officer);
    expect(G.clanInvite(w, B, C)).toBeUndefined(); w.tick += G.CLAN_RULES.inviteTicks + 1; expect(G.clanAccept(w, C, clan)).toBe("invite_expired");
    G.clanInvite(w, B, C); G.clanAccept(w, C, clan);
    expect(G.clanKick(w, C, B)).toBe("no_permission"); expect(G.clanKick(w, B, A)).toBe("outranked");
    expect(G.clanDemote(w, A, C)).toBe("min_rank"); expect(G.clanDemote(w, A, B)).toBeUndefined();
    expect(G.clanKick(w, A, C)).toBeUndefined(); expect(G.clanOf(w, 3)).toBe(0); expect(w.has(C, G.Tribe)).toBe(false); expect(w.has(C, G.ClanStatus)).toBe(false);
    // promoting an officer hands over leadership
    G.clanPromote(w, A, B); G.clanPromote(w, A, B); expect(perms.groups.role(clan, 2)).toBe(GroupRole.Leader); expect(perms.groups.role(clan, 1)).toBe(GroupRole.Officer);
    expect(G.clanLeave(w, B)).toBeUndefined(); expect(perms.groups.role(clan, 1)).toBe(GroupRole.Leader); // handover on leave
    expect(G.clanLeave(w, A)).toBeUndefined(); expect(perms.groups.get(clan)).toBeUndefined(); // last member out = disband
  });
  it("rank perms gate stall actions and base Tribe; goals mirror to members", () => {
    const { w, mk } = setup(); const A = mk(1), B = mk(2); G.clanCreate(w, A); const clan = G.clanOf(w, 1); G.clanInvite(w, A, B); G.clanAccept(w, B, clan);
    const st = place(w, A, "stall_booth"); G.setStallOwnership(w, st, G.tillOf(w, st), G.StallOwnerKind.Clan, clan);
    const stockBit = G.clanPermBit("stock"), baseBit = G.clanPermBit("base");
    expect(can(w, B, st, G.StallActs.stock)).toBe(true); expect(can(w, B, st, G.StallActs.collect)).toBe(false);
    expect(G.clanSetRankPerms(w, B, GroupRole.Member, 0)).toBe("not_leader"); expect(G.clanSetRankPerms(w, A, GroupRole.Leader, 0)).toBe("bad_role");
    expect(G.clanSetRankPerms(w, A, GroupRole.Member, G.clanPermBit("collect"))).toBeUndefined();
    expect(can(w, B, st, G.StallActs.stock)).toBe(false); expect(can(w, B, st, G.StallActs.collect)).toBe(true); expect(w.has(B, G.Tribe)).toBe(false);
    G.clanSetRankPerms(w, A, GroupRole.Member, stockBit | baseBit); expect(w.getField(B, G.Tribe, "id")).toBe(clan);
    expect(G.clanSetGoal(w, B, G.ClanGoal.Raid, 0, 0)).toBe("no_permission"); expect(G.clanSetGoal(w, A, 9, 0, 0)).toBe("bad_goal");
    expect(G.clanSetGoal(w, A, G.ClanGoal.StockStalls, 4, 5)).toBeUndefined(); expect(w.get(B, G.ClanStatus)).toMatchObject({ goal: G.ClanGoal.StockStalls, goalX: 4, goalY: 5 });
    G.addItem(w, B, PLANK, 5); const slot = 0;
    expect(G.stockStall(w, B, st, 0, slot, 3)).toBeUndefined(); expect(w.getField(B, G.ClanStatus, "contrib")).toBe(3);
  });
  it("disband: clan stalls + till go to the leader and close; claims dropped; leader keeps the base tribe", () => {
    const { w, perms, mk } = setup(); const A = mk(1), B = mk(2); G.clanCreate(w, A); const clan = G.clanOf(w, 1); G.clanInvite(w, A, B); G.clanAccept(w, B, clan);
    const st = place(w, A, "stall_booth"); G.setStallOwnership(w, st, G.tillOf(w, st), G.StallOwnerKind.Clan, clan); w.setField(st, G.StallHeader, "open", 1);
    perms.claims.add({ ownerGroup: clan, x0: -5, y0: -5, x1: 5, y1: 5, flags: 0 }); const rev = G.listingRevision(w, st);
    expect(G.clanDisband(w, B)).toBe("not_leader"); expect(G.clanDisband(w, A)).toBeUndefined();
    expect(w.get(st, G.StallHeader)).toMatchObject({ ownerKind: G.StallOwnerKind.Player, ownerId: 1, open: 0 }); expect(G.listingRevision(w, st)).toBeGreaterThan(rev);
    expect(w.get(G.tillOf(w, st)!, OwnedBy)).toEqual({ playerId: 1, groupId: 0 });
    expect(perms.claims.all().some((c) => c.ownerGroup === clan)).toBe(false); expect(perms.groups.get(clan)).toBeUndefined();
    expect(w.getField(A, G.Tribe, "id")).toBe(clan); expect(w.has(B, G.Tribe)).toBe(false); expect(w.getField(B, Membership, "clanId")).toBe(0);
  });
  it("ClanState codec round-trips", () => {
    const { w, mk } = setup(); const A = mk(1); G.clanCreate(w, A); const clan = G.clanOf(w, 1); G.clanSetGoal(w, A, G.ClanGoal.Defend, 1.5, -2);
    G.clanData(w, clan).contrib.set(1, 7); const back = G.decodeClanState(G.encodeClanState(G.clanState(w)));
    expect(back.clans.get(clan)).toEqual(G.clanData(w, clan));
  });
});
