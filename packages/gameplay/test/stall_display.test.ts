import { describe, expect, it } from "vitest";
import { installPermissions, Membership, PlayerId, StallDisplay, STALL_LISTINGS, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import pieces from "../data/pieces.json";
import { makeWorld } from "./helpers.js";

const d = G.defaultDefs(); const COIN = d.itemId("coin"), PLANK = d.itemId("planks");
const snap = (w: World, key: string) => { const sn = G.snapPlacement(w, { piece: d.pieceId(key), x: 1, y: 1, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`); return sn; };

describe("stall display copy", () => {
  it("mirrors enabled listings into core StallDisplay rows", () => {
    const w = makeWorld(); installPermissions(w); G.installEconomy(w);
    const A = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(A, PlayerId, { id: 7 }).add(A, Membership, { partyId: 0, clanId: 0 });
    const stall = G.stallOf(w, G.placePiece(w, A, snap(w, "stall_cart"), { pay: false }))! as Entity;
    G.addItem(w, A, PLANK, 5); G.stockStall(w, A, stall, 0, 0, 5);
    G.setListing(w, A, stall, 0, { priceItem: COIN, priceCount: 3, qty: 2, enabled: 1 });
    G.setListing(w, A, stall, 1, { priceItem: COIN, priceCount: 9, qty: 1, enabled: 0 });
    G.stallDisplaySystem(w);
    const arr = (f: "item" | "qty" | "price" | "currency") => Array.from(w.getArray(stall, StallDisplay, f)!).slice(0, 2);
    expect(arr("item")).toEqual([PLANK, 0]); expect(arr("qty")).toEqual([2, 1]); expect(arr("price")).toEqual([3, 9]); expect(arr("currency")).toEqual([COIN, COIN]);
    expect(G.syncGameplayStallDisplay(w, stall)).toBe(false);
  });
  it("row count comes from the core StallDisplay schema", () => { expect(G.stallDisplayRows()).toBe(STALL_LISTINGS); });
  it("flags stall tiers that StallDisplay would cut off", () => {
    const cut = G.truncatedStallTiers(pieces.pieces as never);
    // Raise core STALL_LISTINGS to 24 to clear this list (ask sent to core/Renderer).
    const expected = [{ key: "stall_booth", listings: 12 }, { key: "clan_pavilion", listings: 24 }].filter((t) => t.listings > G.stallDisplayRows());
    expect(cut.map(({ key, listings }) => ({ key, listings }))).toEqual(expected);
    if (cut.length) console.warn(`StallDisplay (${G.stallDisplayRows()} rows) cuts off: ${cut.map((c) => `${c.key}(${c.listings})`).join(", ")}`);
    expect(G.truncatedStallTiers(pieces.pieces as never, 24)).toEqual([]);
  });
});
