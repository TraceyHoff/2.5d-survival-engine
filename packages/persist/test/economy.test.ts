import { describe, it, expect } from "vitest";
import { ClaimRegistry, defineComponent, GroupRegistry, PlayerNameRegistry, SaleLedger, Transform, type Entity, type World } from "@engine/core";
import { decodePlayerInto, encodePlayer, loadSaleLedger, loadSocial, MemoryWorldStore, NAMES_NS, OwnerKind, SALE_NS, type SocialState } from "../src/index.js";
import { makeWorld, step } from "./helpers.js";

const sale = (i: number) => ({ tick: 10 + i, stallId: 3, stall: 99 as Entity, listing: i % 4, buyer: 98 as Entity, buyerPlayer: 5, ownerPlayer: i % 2 ? 7 : 0, ownerGroup: i % 2 ? 0 : 12, item: 40, qty: 1, currency: 9, price: 3 + i, crafterIds: [555, i] });

describe("economy records (PlayerNameRegistry, SaleLedger)", () => {
  it("saves names + sales into records and restores seq, entries and owner index", async () => {
    const store = new MemoryWorldStore();
    const names = new PlayerNameRegistry(); names.set(5, "Ana"); names.set(7, "Bö"); names.set(5, "Ana2");
    const ledger = new SaleLedger(); for (let i = 0; i < 5; i++) ledger.append(sale(i));
    const social: SocialState = { groups: new GroupRegistry(), claims: new ClaimRegistry(), names, ledger };
    const t = makeWorld(store, { social }); step(t.world); await t.persist.saveAll();
    expect(store.listRecords(SALE_NS)).toHaveLength(5);
    expect(store.listRecords(SALE_NS, { ownerKind: OwnerKind.Player, ownerId: 7 })).toHaveLength(2);
    expect(store.readRecord(NAMES_NS, "registry")).toBeDefined();
    // Incremental: two more sales write just those rows.
    ledger.append(sale(5)); ledger.append(sale(6)); const before = t.persist.stats.socialSaves; await t.persist.saveAll();
    expect(t.persist.stats.socialSaves - before).toBe(2);
    const back = loadSocial(store);
    expect(back.names!.get(5)).toBe("Ana2"); expect(back.names!.display(7)).toBe("Bö"); expect(back.names!.seq).toBe(names.seq);
    const got = back.ledger!.entriesSince(0)!; expect(got.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(got[6]).toMatchObject({ price: 9, crafterIds: [555, 6], ownerPlayer: 0, ownerGroup: 12, stall: 0, buyer: 0 });
    expect(back.ledger!.append(sale(9)).seq).toBe(8); // seq continues
  });
  it("old saves without records load empty registries; ledger rows beyond capacity are deleted", async () => {
    expect(loadSocial(new MemoryWorldStore()).ledger!.seq).toBe(0);
    const store = new MemoryWorldStore(); const ledger = new SaleLedger(3);
    const t = makeWorld(store, { social: { groups: new GroupRegistry(), claims: new ClaimRegistry(), ledger } });
    for (let i = 0; i < 4; i++) ledger.append(sale(i)); await t.persist.saveAll();
    for (let i = 4; i < 9; i++) ledger.append(sale(i)); await t.persist.saveAll();
    expect(store.listRecords(SALE_NS).map((r) => r.id)).toEqual(["0000000007", "0000000008", "0000000009"]);
    const back = loadSaleLedger(store, 3); expect(back.seq).toBe(9); expect(back.entriesSince(6)!.length).toBe(3);
  });
});

const OldInv = defineComponent("Inventory", { items: { type: "u16", length: 4 }, counts: { type: "u16", length: 4 }, durability: { type: "u16", length: 4 } }, { persistent: true });
const NewInv = defineComponent("Inventory", { items: { type: "u16", length: 4 }, counts: { type: "u16", length: 4 }, durability: { type: "u16", length: 4 }, crafterId: { type: "u32", length: 4 } }, { persistent: true });
const OldBox = defineComponent("Container", { items: { type: "u16", length: 2 }, counts: { type: "u16", length: 2 } }, { persistent: true });
const NewBox = defineComponent("Container", { items: { type: "u16", length: 2 }, crafterId: { type: "u32", length: 2 }, counts: { type: "u16", length: 2 } }, { persistent: true });
const arr = (w: World, e: Entity, def: typeof NewInv | typeof NewBox, f: string): number[] => { const st = w.store(def); const n = st.lengths[f]!; const s = st.slot((e as number) & 0xfffff); return [...st.data[f]!.slice(s * n, s * n + n)]; };

describe("crafterId schema migration (fills 0)", () => {
  it("chunk rows written before crafterId decode with crafterId = 0 and the rest intact", async () => {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { setup: (w) => { w.register(OldInv); w.register(OldBox); } }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    const e = a.world.create(); a.world.add(e, Transform, { x: 3, y: 4 }).add(e, OldInv, { items: [1, 2, 3, 4], counts: [5, 6, 7, 8], durability: [9, 9, 9, 9] } as never).add(e, OldBox, { items: [11, 12], counts: [13, 14] } as never);
    step(a.world); await a.persist.saveAll(); expect(store.readChunk("0,0")).toBeDefined();
    const b = makeWorld(store, { setup: (w) => { w.register(NewInv); w.register(NewBox); } }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    expect(b.persist.stats.decodeErrors).toBe(0); expect(b.persist.stats.migratedChunks).toBeGreaterThan(0);
    const found = [...b.world.query([NewInv, NewBox])]; expect(found.length).toBe(1); const x = found[0]!;
    expect(arr(b.world, x, NewInv, "items")).toEqual([1, 2, 3, 4]); expect(arr(b.world, x, NewInv, "durability")).toEqual([9, 9, 9, 9]);
    expect(arr(b.world, x, NewInv, "crafterId")).toEqual([0, 0, 0, 0]);
    expect(arr(b.world, x, NewBox, "counts")).toEqual([13, 14]); expect(arr(b.world, x, NewBox, "crafterId")).toEqual([0, 0]);
    expect(b.world.getField(x, Transform, "x")).toBeCloseTo(3);
  });
  it("player records written before crafterId restore their inventory (was: skipped)", () => {
    const a = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(OldInv) }).world;
    const p = a.create(); a.add(p, OldInv, { items: [7, 0, 0, 1], counts: [2, 0, 0, 3], durability: [0, 0, 0, 0] } as never);
    const bytes = encodePlayer(a, p);
    const b = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(NewInv) }).world; const q = b.create();
    const r = decodePlayerInto(b, q, bytes);
    expect(r.restored).toContain("Inventory"); expect(r.migrated).toEqual(["Inventory"]);
    expect(arr(b, q, NewInv, "items")).toEqual([7, 0, 0, 1]); expect(arr(b, q, NewInv, "crafterId")).toEqual([0, 0, 0, 0]);
    expect(decodePlayerInto(b, q, bytes, { migrations: [] }).skipped).toContain("Inventory");
  });
});
