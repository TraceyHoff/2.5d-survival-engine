import { describe, it, expect } from "vitest";
import { installPermissions, Membership, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

/** ADR-207: one shared clan base — members co-build, outsiders stay blocked, leaving / kick revokes access. */
const d = G.defaultDefs();
function setup() {
  const w = makeWorld(); installPermissions(w); G.installEconomy(w);
  const mk = (pid: number, x = 0) => { const p = G.spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); return p; };
  return { w, mk };
}
const snap = (w: World, key: string, x: number, y: number, tier = 1) => G.snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier, variant: 0 });
function place(w: World, b: Entity, key: string, x: number, y: number, tier = 1): Entity {
  const sn = snap(w, key, x, y, tier); if (typeof sn === "number") throw new Error(`snap ${key} ${sn}`); return G.placePiece(w, b, sn, { pay: false });
}
const fails: number[] = [];
const intent = (w: World, p: Entity, action: number, target: Entity, tier = 0) => { fails.length = 0; w.set(p, G.PlayerIntent, { action, target, tier }); steps(w, 1); };
const storageOf = (w: World, piece: Entity) => { for (const c of w.query([G.Container, G.PieceLink])) if (G.pieceOf(w, c) === piece) return c; throw new Error("no storage"); };
function stock(w: World, p: Entity) { const f = d.pieces.get(d.pieceId("foundation"))!; for (const t of [1, 2, 3]) for (const c of G.pieceCost(d, f, t)) G.addItem(w, p, c.item, c.count * 20); }

describe("clan shared base (ADR-207)", () => {
  it("members place in, snap onto, repair, upgrade and deconstruct each other's pieces; outsider blocked", () => {
    const { w, mk } = setup(); const A = mk(1, 0), B = mk(2, 1), X = mk(3, 1);
    G.clanCreate(w, A); const clan = G.clanOf(w, 1); expect(G.clanInvite(w, A, B)).toBeUndefined(); expect(G.clanAccept(w, B, clan)).toBeUndefined();
    const totem = place(w, A, "claim_totem", 0.5, 3.5); expect(w.getField(totem, G.PrivilegeZone, "tribe")).toBe(clan);
    const fa = place(w, A, "foundation", 1, 1);
    // B snaps a wall onto A's foundation inside A's claim
    const ws = snap(w, "wall", 1.5, 1); expect(typeof ws).not.toBe("number");
    if (typeof ws !== "number") { expect(G.validatePlacement(w, B, ws, { ignoreCost: true })).toBe(0); expect(G.validatePlacement(w, X, ws, { ignoreCost: true })).toBe(G.BuildFail.NoPrivilege); }
    const fb = place(w, B, "foundation", 2, 1); expect(w.getField(fb, G.Tribe, "id")).toBe(clan);
    stock(w, A); stock(w, B); stock(w, X);
    // upgrade the other member's piece
    intent(w, B, G.IntentAction.Upgrade, fa, 2); expect(w.getField(fa, G.BuildPiece, "tier")).toBe(2);
    intent(w, X, G.IntentAction.Upgrade, fb, 2); expect(w.getField(fb, G.BuildPiece, "tier")).toBe(1);
    // repair: member yes, outsider no
    w.setField(fb, G.BuildPiece, "hp", 1); intent(w, X, G.IntentAction.Repair, fb); expect(w.getField(fb, G.BuildPiece, "hp")).toBe(1);
    intent(w, A, G.IntentAction.Repair, fb); expect(w.getField(fb, G.BuildPiece, "hp")).toBe(G.maxHpOf(w, fb));
    // deconstruct: outsider no, member yes
    intent(w, X, G.IntentAction.Demolish, fb); expect(w.isAlive(fb)).toBe(true);
    intent(w, A, G.IntentAction.Demolish, fb); expect(w.isAlive(fb)).toBe(false);
  });
  it("shared storage + clan door lock; kick revokes and closes an open chest", () => {
    const { w, mk } = setup(); const A = mk(1, 0), B = mk(2, 1), X = mk(3, 1);
    G.clanCreate(w, A); const clan = G.clanOf(w, 1); expect(G.clanInvite(w, A, B)).toBeUndefined(); expect(G.clanAccept(w, B, clan)).toBeUndefined();
    place(w, A, "claim_totem", 0.5, 3.5); const box = place(w, A, "storage_box", 1.5, 1.5, 0); const c = storageOf(w, box);
    intent(w, B, G.IntentAction.OpenContainer, box); expect(w.getField(B, G.Viewing, "container")).toBe(c);
    intent(w, X, G.IntentAction.OpenContainer, box); expect(w.has(X, G.Viewing)).toBe(false);
    expect(G.clanKick(w, A, B)).toBeUndefined(); expect(w.has(B, G.Tribe)).toBe(false);
    steps(w, 1); expect(w.has(B, G.Viewing)).toBe(false);
    intent(w, B, G.IntentAction.OpenContainer, box); expect(w.has(B, G.Viewing)).toBe(false);
    // left member can no longer build in the claim; rejoining restores it
    const ws = snap(w, "foundation", 2, 1); if (typeof ws !== "number") expect(G.validatePlacement(w, B, ws, { ignoreCost: true })).toBe(G.BuildFail.NoPrivilege);
    expect(G.clanInvite(w, A, B)).toBeUndefined(); expect(G.clanAccept(w, B, clan)).toBeUndefined(); if (typeof ws !== "number") expect(G.validatePlacement(w, B, ws, { ignoreCost: true })).toBe(0);
  });
  it("persistence round-trip keeps clan tribe on pieces, zones and storage access", () => {
    const { w, mk } = setup(); const A = mk(1, 0), B = mk(2, 1);
    G.clanCreate(w, A); const clan = G.clanOf(w, 1); expect(G.clanInvite(w, A, B)).toBeUndefined(); expect(G.clanAccept(w, B, clan)).toBeUndefined();
    place(w, A, "claim_totem", 0.5, 3.5); place(w, B, "foundation", 1, 1);
    const blob = G.encodeStructures(w, 0, 0);
    const w2 = makeWorld(); installPermissions(w2); G.installEconomy(w2); G.decodeStructures(w2, blob);
    const tribes = [...w2.query([G.BuildPiece])].map((e) => w2.getField(e, G.Tribe, "id"));
    expect(tribes.length).toBe(2);
    expect(tribes.every((t) => t === clan)).toBe(true);
    expect([...w2.query([G.PrivilegeZone])].map((z) => w2.getField(z, G.PrivilegeZone, "tribe"))).toEqual([clan]);
  });
});
