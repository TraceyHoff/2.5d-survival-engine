import { describe, it, expect } from "vitest";
import { World, defineComponent, installContainers, arrayFieldsContainer, transfer, transaction, sameStack, encodeSnapshot, decodeSnapshot, applySnapshot,
  installPermissions, definePermissionActions, PlayerId, GroupKind, GroupRole, PlayerNameRegistry, installStalls, makeStall, setStallListing, stockStall,
  withdrawStall, buyFromStall, atomicPurchase, stallRevision, TradeStall, SaleLedger, NetId, StallDisplay, syncStallDisplay, addStallDisplay, STALL_LISTINGS, STALL_DISPLAY_ROWS } from "../src/index.js";

const N = 6;
const Inv = defineComponent("InvEco", { items: { type: "u16", length: N }, counts: { type: "u16", length: N }, createdTick: { type: "u32", length: N },
  durability: { type: "u16", length: N }, crafterId: { type: "u32", length: N } }, { networked: true, persistent: true });
const A = definePermissionActions(["Stock", "Withdraw", "Manage", "Buy"]);
const COIN = 9, AXE = 7, ROPE = 3;
function setup() {
  const w = new World(); w.register(Inv); const C = installContainers(w);
  C.register(Inv, arrayFieldsContainer(Inv, { item: "items", count: "counts", createdTick: "createdTick", durability: "durability", crafterId: "crafterId" }));
  const P = installPermissions(w); const S = installStalls(w, { stock: A.Stock, withdraw: A.Withdraw, manage: A.Manage });
  const player = (id: number) => { const e = w.create(); w.add(e, Inv); w.add(e, PlayerId, { id }); return e; };
  return { w, P, S, player };
}
const slots = (w: World, e: number) => { const v = w.get(e, Inv)!; return Array.from({ length: N }, (_, i) => ({ item: v.items[i], count: v.counts[i], crafterId: v.crafterId[i], durability: v.durability[i] })).filter((s) => s.item); };

describe("crafterId slot metadata", () => {
  it("sameStack and add(): different crafterId never stacks; equal merges", () => {
    const { w, player } = setup(); const a = player(1);
    expect(sameStack({ crafterId: 5 }, { crafterId: 5, durability: 0 })).toBe(true); expect(sameStack({ crafterId: 5 }, {})).toBe(false);
    transaction(w, (tx) => { tx.add(a, ROPE, 3, { crafterId: 42 }); tx.add(a, ROPE, 2); return tx.add(a, ROPE, 4, { crafterId: 42 }); });
    expect(slots(w, a)).toEqual([{ item: ROPE, count: 7, crafterId: 42, durability: 0 }, { item: ROPE, count: 2, crafterId: 0, durability: 0 }]);
  });
  it("transfer keeps crafterId, refuses partial merge into a foreign-crafter stack, swaps whole stacks", () => {
    const { w, player } = setup(); const a = player(1), b = player(2);
    transaction(w, (tx) => { tx.add(a, ROPE, 5, { crafterId: 42 }); return tx.add(b, ROPE, 5, { crafterId: 43 }); });
    expect(transfer(w, a, 0, b, 0, 2)).toEqual({ ok: false, reason: "occupied" });
    expect(transfer(w, a, 0, b, 1, 2)).toEqual({ ok: true }); expect(slots(w, b)[1]).toMatchObject({ count: 2, crafterId: 42 });
    expect(transfer(w, a, 0, b, 0, 3)).toEqual({ ok: true }); expect(slots(w, b)[0]).toMatchObject({ count: 3, crafterId: 42 }); expect(slots(w, a)[0]).toMatchObject({ count: 5, crafterId: 43 });
    expect(transfer(w, b, 1, b, 0, 2)).toEqual({ ok: true }); expect(slots(w, b)).toEqual([{ item: ROPE, count: 5, crafterId: 42, durability: 0 }]);
  });
  it("rollback restores crafterId", () => {
    const { w, player } = setup(); const a = player(1); transaction(w, (tx) => tx.add(a, AXE, 1, { crafterId: 8, durability: 50 }));
    const before = JSON.stringify(w.get(a, Inv));
    transaction(w, (tx) => { tx.take(a, AXE, 1); tx.add(a, ROPE, 1, { crafterId: 9 }); return { ok: false, reason: "x" }; });
    expect(JSON.stringify(w.get(a, Inv))).toBe(before);
  });
  it("snapshot round-trip carries crafterId (net); chunk persistence uses the same schema fields", () => {
    const { w, player } = setup(); const a = player(1); w.add(a, NetId, { id: 1 } as never);
    transaction(w, (tx) => tx.add(a, AXE, 1, { crafterId: 0xfffffff0, durability: 77, createdTick: 123 }));
    const b = setup().w; b.create(); applySnapshot(b, decodeSnapshot(b, encodeSnapshot(w, { all: true })));
    expect(Array.from(b.get(a, Inv)!.crafterId).slice(0, 1)).toEqual([0xfffffff0]);
  });
});

describe("PlayerNameRegistry", () => {
  it("set/display/change log/apply/encode-decode", () => {
    const r = new PlayerNameRegistry(); r.set(42, "Mira"); r.set(7, "Ödön"); r.set(42, "Mira"); r.set(7, null); r.set(7, "Bo");
    expect(r.display(42)).toBe("Mira"); expect(r.display(99)).toBe("#99"); expect(r.display(0)).toBe("");
    expect(r.seq).toBe(4); expect(r.changesSince(2)!.map((c) => c.name)).toEqual([null, "Bo"]);
    const m = new PlayerNameRegistry(); for (const c of r.changesSince(0)!) m.apply(c); expect(m.entries()).toEqual(r.entries()); expect(m.seq).toBe(4);
    const d = PlayerNameRegistry.decode(r.encode()); expect(d.entries()).toEqual([[7, "Bo"], [42, "Mira"]]); expect(d.seq).toBe(4);
    expect(() => r.set(1, "x".repeat(65))).toThrow(); expect(() => r.set(0, "a")).toThrow();
    const small = new PlayerNameRegistry(2); for (let i = 1; i <= 5; i++) small.set(i, `p${i}`); expect(small.changesSince(0)).toBeUndefined();
  });
});

describe("trade stalls", () => {
  function clanStall() {
    const s = setup(); const { w, P } = s; P.policy.minRole.set(A.Withdraw, GroupRole.Officer); P.policy.minRole.set(A.Manage, GroupRole.Officer);
    const leader = s.player(1), member = s.player(2), outsider = s.player(3);
    const clan = P.groups.create(GroupKind.Clan, 1); P.groups.addMember(clan.id, 2);
    const stall = w.create(); w.add(stall, Inv); makeStall(w, stall, { groupId: clan.id });
    return { ...s, leader, member, outsider, stall, clan };
  }
  it("permissions: members stock, officers withdraw/manage, outsiders denied; revision bumps", () => {
    const { w, leader, member, outsider, stall } = clanStall();
    transaction(w, (tx) => tx.add(member, ROPE, 10, { crafterId: 2 }));
    const r0 = stallRevision(w, stall);
    expect(stockStall(w, member, stall, member, 0, 0, 10)).toEqual({ ok: true }); expect(stallRevision(w, stall)).toBe(r0 + 1);
    expect(withdrawStall(w, member, stall, 0, member, 0, 1)).toEqual({ ok: false, reason: "denied" });
    expect(setStallListing(w, member, stall, 0, { item: ROPE, qty: 2, price: 5, currency: COIN })).toEqual({ ok: false, reason: "denied" });
    expect(stockStall(w, outsider, stall, outsider, 0, 1, 1)).toEqual({ ok: false, reason: "denied" });
    expect(setStallListing(w, leader, stall, 0, { item: ROPE, qty: 2, price: 5, currency: COIN })).toEqual({ ok: true });
    expect(setStallListing(w, leader, stall, 1, { item: ROPE, qty: 0, price: 5, currency: COIN })).toEqual({ ok: false, reason: "bad_listing" });
    expect(withdrawStall(w, leader, stall, 0, leader, 0, 1)).toEqual({ ok: true }); expect(stallRevision(w, stall)).toBe(r0 + 3);
    expect(slots(w, leader)[0]).toMatchObject({ item: ROPE, count: 1, crafterId: 2 });
  });
  it("StallDisplay mirrors listings via setStallListing/stock/withdraw/buy; networked; optional", () => {
    const { w, leader, outsider, stall } = clanStall();
    expect(StallDisplay.networked).toBe(true); expect(syncStallDisplay(w, stall)).toBe(false);
    setStallListing(w, leader, stall, 2, { item: ROPE, qty: 3, price: 70000, currency: COIN });
    addStallDisplay(w, stall); const arr = (f: "item" | "qty" | "price" | "currency") => Array.from(w.getArray(stall, StallDisplay, f)!);
    expect(STALL_DISPLAY_ROWS).toBe(24); expect(arr("item")).toHaveLength(STALL_DISPLAY_ROWS); expect(arr("currency")).toHaveLength(24); expect(arr("item")[2]).toBe(ROPE); expect(arr("price")[2]).toBe(70000);
    setStallListing(w, leader, stall, 0, { item: AXE, qty: 1, price: 5, currency: COIN });
    expect([arr("item")[0], arr("qty")[0], arr("price")[0], arr("currency")[0]]).toEqual([AXE, 1, 5, COIN]);
    setStallListing(w, leader, stall, 2, null); expect(arr("item")[2]).toBe(0); expect(arr("price")[2]).toBe(0);
    transaction(w, (tx) => { tx.add(stall, AXE, 1); return tx.add(outsider, COIN, 5); });
    w.getArray(stall, StallDisplay, "price")![0] = 1; // drift; next core op resyncs
    expect(buyFromStall(w, outsider, stall, 0).ok).toBe(true); expect(arr("price")[0]).toBe(5);
    expect(syncStallDisplay(w, stall)).toBe(false);
    // rows past TradeStall's STALL_LISTINGS stay empty and are re-zeroed on drift
    w.getArray(stall, StallDisplay, "item")![STALL_LISTINGS + 3] = 99; expect(syncStallDisplay(w, stall)).toBe(true); expect(arr("item")[STALL_LISTINGS + 3]).toBe(0);
  });
  it("atomic purchase moves goods with crafterId, pays the stall, appends the ledger", () => {
    const { w, S, leader, outsider, stall, clan } = clanStall();
    transaction(w, (tx) => { tx.add(stall, ROPE, 4, { crafterId: 2 }); return tx.add(outsider, COIN, 12); });
    setStallListing(w, leader, stall, 0, { item: ROPE, qty: 3, price: 10, currency: COIN }); const rev = stallRevision(w, stall);
    expect(buyFromStall(w, outsider, stall, 0, { expectRevision: rev - 1 })).toEqual({ ok: false, reason: "stale_revision" });
    const r = buyFromStall(w, outsider, stall, 0, { expectRevision: rev }); expect(r.ok).toBe(true);
    expect(slots(w, outsider)).toEqual([{ item: COIN, count: 2, crafterId: 0, durability: 0 }, { item: ROPE, count: 3, crafterId: 2, durability: 0 }]);
    expect(slots(w, stall)).toEqual([{ item: ROPE, count: 1, crafterId: 2, durability: 0 }, { item: COIN, count: 10, crafterId: 0, durability: 0 }]);
    const led = S.ledger.entriesSince(0)!; expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ seq: 1, buyerPlayer: 3, ownerGroup: clan.id, item: ROPE, qty: 3, currency: COIN, price: 10, crafterIds: [2] });
    expect(S.ledger.entriesSince(1)).toEqual([]); expect(stallRevision(w, stall)).toBe(rev + 1);
  });
  it("failures roll back everything: out of stock, insufficient funds, buyer full, stall full", () => {
    const { w, S, leader, outsider, stall } = clanStall();
    setStallListing(w, leader, stall, 0, { item: ROPE, qty: 3, price: 10, currency: COIN });
    const snap = () => JSON.stringify([w.get(stall, Inv), w.get(outsider, Inv), stallRevision(w, stall)]);
    transaction(w, (tx) => tx.add(outsider, COIN, 50));
    let s = snap(); expect(buyFromStall(w, outsider, stall, 0)).toEqual({ ok: false, reason: "out_of_stock" }); expect(snap()).toBe(s);
    transaction(w, (tx) => tx.add(stall, ROPE, 3, { crafterId: 2 }));
    const poor = setup; void poor;
    // buyer full: fill outsider with junk (5 other slots with distinct crafters)
    transaction(w, (tx) => { for (let i = 0; i < 5; i++) if (!tx.add(outsider, 50 + i, 1).ok) return { ok: false, reason: "x" }; return { ok: true }; });
    s = snap(); expect(buyFromStall(w, outsider, stall, 0)).toEqual({ ok: false, reason: "buyer_full" }); expect(snap()).toBe(s);
    transaction(w, (tx) => tx.remove(outsider, COIN, 50)); // now outsider has a free slot but no coins
    s = snap(); expect(buyFromStall(w, outsider, stall, 0)).toEqual({ ok: false, reason: "insufficient_funds" }); expect(snap()).toBe(s);
    // stall full: stall slots all occupied by goods with different crafters -> currency cannot land
    transaction(w, (tx) => { tx.add(outsider, COIN, 10); for (let i = 0; i < 5; i++) tx.add(stall, 60 + i, 1); return { ok: true }; });
    expect(slots(w, stall)).toHaveLength(6);
    s = snap(); expect(atomicPurchase(w, { buyer: outsider, stock: stall, item: ROPE, qty: 1, currency: COIN, price: 10 })).toEqual({ ok: false, reason: "stall_full" }); expect(snap()).toBe(s);
    expect(S.ledger.seq).toBe(0); expect(w.has(stall, TradeStall)).toBe(true);
  });
  it("ledger capacity truncation is reported", () => {
    const l = new SaleLedger(2); for (let i = 0; i < 3; i++) l.append({ tick: i } as never); expect(l.entriesSince(0)).toBeUndefined(); expect(l.entriesSince(1)!.map((e) => e.seq)).toEqual([2, 3]);
  });
});
