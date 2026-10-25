import { describe, it, expect } from "vitest";
import { canAt, GroupKind, installPermissions, Membership, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import {
  addItem, decodeStructures, defaultDefs, encodeStructures, placePiece, playerNames, sanitizeStallName, setListing, setStallName, setStallOpen,
  snapPlacement, spawnPlayer, stallName, stallOf, stallSoldOut, stockStall, StallActs, unloadStructures, validatePlacement, buyFromStall,
  stallListing, listingRevision, unstockStall,
} from "../src/index.js";
import { makeWorld } from "./helpers.js";

const d = defaultDefs(); const COIN = d.itemId("coin"), PLANK = d.itemId("planks");
function setup() {
  const w = makeWorld(); const perms = installPermissions(w); G.installEconomy(w); const names = playerNames(w);
  const mk = (pid: number, x = 0) => { const p = spawnPlayer(w, { x, y: 0, maxWeight: 0, clientId: pid }); w.add(p, PlayerId, { id: pid }).add(p, Membership, { partyId: 0, clanId: 0 }); names.set(pid, `p${pid}`); return p; };
  return { w, perms, mk };
}
const snap = (w: World, key: string, x = 1, y = 1) => { const sn = snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`); return sn; };
const place = (w: World, b: Entity, key: string, x = 1, y = 1) => stallOf(w, placePiece(w, b, snap(w, key, x, y), { pay: false }))!;

describe("stalls obey land claims", () => {
  it("foreign claim / NoBuild refuse placement; own claim allows", () => {
    const { w, perms, mk } = setup(); const A = mk(7); const B = mk(9);
    const clan = perms.groups.create(GroupKind.Clan, 7).id;
    perms.claims.add({ ownerGroup: clan, x0: -10, y0: -10, x1: 10, y1: 10, flags: 0 });
    expect(validatePlacement(w, A, snap(w, "stall_booth"), { ignoreCost: true })).not.toBe(5);
    expect(validatePlacement(w, B, snap(w, "stall_booth"), { ignoreCost: true })).toBe(5);
    perms.claims.add({ ownerGroup: 0, x0: 40, y0: 40, x1: 60, y1: 60, flags: 8 });
    expect(canAt(w, A, 50, 50, StallActs.place)).toBe(false);
  });
  it("a stall standing in a foreign claim cannot sell", () => {
    const { w, perms, mk } = setup(); const A = mk(7); const B = mk(9, 1);
    const stall = place(w, A, "stall_booth"); addItem(w, A, PLANK, 5);
    stockStall(w, A, stall, 0, 0, 5); setListing(w, A, stall, 0, { priceItem: COIN, priceCount: 1, qty: 1, enabled: 1 }); setStallOpen(w, A, stall, 1);
    addItem(w, B, COIN, 3);
    const other = perms.groups.create(GroupKind.Clan, 9).id; perms.claims.add({ ownerGroup: other, x0: -10, y0: -10, x1: 10, y1: 10, flags: 0 });
    const l = stallListing(w, stall, 0)!;
    const r = { listingSlot: 0, qty: 1, expectedRevision: listingRevision(w, stall), expectedPriceItem: l.priceItem, expectedPriceCount: l.priceCount };
    expect(buyFromStall(w, B, stall, r)).toBe("forbidden");
  });
});
describe("market_counter, sign text, soldOut", () => {
  it("market_counter is a clan-only 6-listing stall and needs a clan", () => {
    const { w, perms, mk } = setup(); const A = mk(7);
    const p = d.pieces.get(d.pieceId("market_counter"))!; expect(p.stall).toEqual({ listings: 6, clanOnly: true });
    expect(validatePlacement(w, A, snap(w, "market_counter"), { ignoreCost: true })).toBe(5);
    const clan = perms.groups.create(GroupKind.Clan, 7).id; w.setField(A, Membership, "clanId", clan);
    expect(validatePlacement(w, A, snap(w, "market_counter"), { ignoreCost: true })).not.toBe(5);
    const s = place(w, A, "market_counter"); expect(w.get(s, G.StallHeader)).toMatchObject({ ownerKind: G.StallOwnerKind.Clan, ownerId: clan, listingCount: 6 });
  });
  it("sanitizes, persists and permission-checks the sign; soldOut tracks stock", () => {
    const { w, mk } = setup(); const A = mk(7); const B = mk(9, 1);
    const stall = place(w, A, "stall_booth");
    expect(sanitizeStallName("  Ada's\n\tfine   goods\u0007 ✨ and more more more more")).toBe("Ada's fine goods and mor");
    expect(setStallName(w, B, stall, "mine")).toBe("forbidden");
    expect(setStallName(w, A, stall, "Ada's Planks")).toBeUndefined(); expect(stallName(w, stall)).toBe("Ada's Planks");
    expect(stallSoldOut(w, stall)).toBe(true);
    addItem(w, A, PLANK, 2); stockStall(w, A, stall, 0, 0, 2);
    setListing(w, A, stall, 0, { priceItem: COIN, priceCount: 1, qty: 1, enabled: 1 }); expect(stallSoldOut(w, stall)).toBe(false);
    const blob = encodeStructures(w, 0, 0); for (const k of [...G.structures(w).chunkPieces.keys()]) unloadStructures(w, k);
    const s2 = stallOf(w, decodeStructures(w, blob).pieces[0]!)!; expect(encodeStructures(w, 0, 0)).toEqual(blob); expect(stallName(w, s2)).toBe("Ada's Planks"); expect(stallSoldOut(w, s2)).toBe(false);
    unstockStall(w, A, s2, 0, 2); expect(stallSoldOut(w, s2)).toBe(true);
  });
});

describe("ADR-142 market stalls stand on bare ground", () => {
  it("every stall piece validates with no foundation (was NoSupport = 11)", () => {
    const { w, mk } = setup(); const A = mk(7);
    for (const key of ["stall_blanket", "stall_cart", "stall_booth"]) {
      expect([key, validatePlacement(w, A, snap(w, key, 1, 1), { ignoreCost: true })]).toEqual([key, 0]);
    }
  });
});

describe("ADR-142 stall view on a client replica", () => {
  it("header without Listings/Container data yields no listings instead of throwing", () => {
    const w = makeWorld(); const e = w.create(); w.add(e, G.StallHeader, { ownerKind: 1, ownerId: 7, open: 1, listingCount: 4 });
    expect(() => G.stallListings(w, e)).not.toThrow(); expect(G.stallListings(w, e)).toEqual([]); expect(G.stallListing(w, e, 0)).toBeUndefined();
  });
});
