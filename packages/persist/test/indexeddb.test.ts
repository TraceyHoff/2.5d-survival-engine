import { describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { ClaimRegistry, GroupRegistry, Owner, Permissions, Transform, installPermissions } from "@engine/core";
import { IndexedDbWorldStore, loadSocial, PLAYER_VERSION, type IdbFactoryLike, type StoredChunk } from "../src/index.js";
import { Crate, Stash, PIECES, buildBase, makeWorld, spawnCrate, step } from "./helpers.js";

const CLAN = 2;
const open = (factory: IdbFactoryLike, name = "world") => IndexedDbWorldStore.open(name, { factory });
/** Steps the world, then lets pending IndexedDB reads land (ChunkManager installs them on resolution). */
async function stepAsync(t: ReturnType<typeof makeWorld>, n = 1): Promise<void> { for (let i = 0; i < n; i++) { step(t.world); await t.chunks.settle(); } }

describe("IndexedDbWorldStore (fake-indexeddb) + async chunk provider", () => {
  it("round-trips chunks (buildings, entities, array fields), players, meta and social state across a reopen", async () => {
    const factory = new IDBFactory();
    const s1 = await open(factory);
    expect(s1.readMeta()).toBeUndefined();
    const social = { groups: new GroupRegistry(), claims: new ClaimRegistry() };
    const a = makeWorld(s1, { social, setup: (w) => installPermissions(w, social) });
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); await stepAsync(a);
    expect(a.chunks.getChunk(0, 0)).toBeDefined();
    expect(buildBase(a.buildings, 0, 0, 600)).toBe(600);
    spawnCrate(a.world, 4, 5, 77);
    const st = a.world.create(); a.world.add(st, Transform, { x: 9, y: 9 }).add(st, Stash, { items: [1, 2, 3, 4, 5, 6, 7, 65535], mods: [0.5, -1.25, 3] });
    a.chunks.setTile(3, 4, 123);
    const clan = social.groups.create(CLAN, 11); social.groups.setBanner(clan.id, { shape: 1, pattern: 2, colors: [3, 4], emblemId: 5 });
    social.claims.add({ ownerGroup: clan.id, x0: 0, y0: 0, x1: 16, y1: 16, flags: 1 });
    const p = a.world.create(); a.world.add(p, Transform, { x: 7, y: 8 }).add(p, Owner, { clientId: 3 }).add(p, Stash, { counts: [9, 9, 9, 9, 9, 9, 9, 9] });
    a.persist.trackPlayer("aa".repeat(16), p, "ida");
    await stepAsync(a, 2);
    const r = await a.persist.saveAll();
    expect(r).toMatchObject({ chunks: 1, players: 1 });
    expect(s1.stats().committedChunks).toBe(1);
    const tick = a.world.tick;
    await s1.close();

    const s2 = await open(factory);
    expect(s2.readMeta()).toMatchObject({ seed: 42, tick });
    expect(s2.count("chunks")).toBe(1); expect(s2.count("players")).toBe(1);
    expect(s2.readChunk("0,0")).toBeUndefined(); // not prefetched: sync read misses, async read hits
    const social2 = loadSocial(s2);
    expect(social2.groups.get(clan.id)?.banner).toEqual({ shape: 1, pattern: 2, colors: [3, 4], emblemId: 5 });
    expect(social2.claims.zoneAt(5, 5)).toBe(1);
    const b = makeWorld(s2, { social: social2, setup: (w) => installPermissions(w, social2) });
    b.chunks.setSource({ id: 1, x: 16, y: 16 });
    step(b.world);
    expect(b.chunks.getChunk(0, 0)).toBeUndefined(); // in flight
    expect(b.chunks.inflightLoads).toBe(1);
    await b.chunks.settle();
    expect(b.chunks.getTile(3, 4)).toBe(123);
    expect(b.buildings.layer("0,0")?.anchored.size).toBe(600);
    expect([...b.world.query([Crate])].map((e) => b.world.get(e, Crate)!.loot)).toEqual([77]);
    const [st2] = [...b.world.query([Stash])];
    expect([...b.world.getArray(st2!, Stash, "items")!]).toEqual([1, 2, 3, 4, 5, 6, 7, 65535]);
    expect(b.world.resource(Permissions).groups.get(clan.id)?.members.get(11)).toBe(3);
    const p2 = b.world.create(); b.world.add(p2, Owner, { clientId: 9 });
    expect(b.persist.restorePlayer("aa".repeat(16), p2)?.name).toBe("ida");
    expect(b.world.get(p2, Transform)).toMatchObject({ x: 7, y: 8 });
    expect([...b.world.getArray(p2, Stash, "counts")!]).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(b.persist.stats).toMatchObject({ chunksLoadedFromStore: 1, asyncReads: 1, asyncLateDropped: 0 });
    // unload -> saved (overlay serves the immediate reload synchronously), then committed
    b.chunks.setSource({ id: 1, x: 5000, y: 5000 }); step(b.world); await b.chunks.settle();
    await s2.close();
  });

  it("dedups concurrent loads and discards late results without decoding (no stray entities)", async () => {
    const factory = new IDBFactory();
    const s1 = await open(factory);
    const a = makeWorld(s1); a.chunks.setSource({ id: 1, x: 16, y: 16 }); await stepAsync(a);
    spawnCrate(a.world, 4, 5, 1); await stepAsync(a); await a.persist.saveAll(); await s1.close();

    const s2 = await open(factory);
    let reads = 0; const orig = s2.readChunkAsync.bind(s2);
    s2.readChunkAsync = (k) => { reads++; return orig(k); };
    const b = makeWorld(s2);
    // dedup: two loads of the same key share one read
    const l1 = b.persist.provider.load(0, 0), l2 = b.persist.provider.load(0, 0);
    expect(l1).toBeInstanceOf(Promise); expect(l2).toBe(l1); expect(reads).toBe(1);
    await l1; // not attached to a pending request: chunks.isPending false -> dropped undecoded
    expect(b.persist.stats.asyncLateDropped).toBe(1);
    expect([...b.world.query([Crate])]).toHaveLength(0);

    // late result: requested, then the player walks away before the read lands
    b.chunks.setSource({ id: 1, x: 16, y: 16 }); b.chunks.update(); expect(b.chunks.inflightLoads).toBe(1);
    b.chunks.setSource({ id: 1, x: 9000, y: 9000 }); b.chunks.update(); expect(b.chunks.inflightLoads).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.persist.stats.asyncLateDropped).toBe(2);
    expect(b.chunks.getChunk(0, 0)).toBeUndefined(); expect([...b.world.query([Crate])]).toHaveLength(0);

    // drop then re-request while the read is still in flight: one read, decoded once, installed once
    const before = reads;
    b.chunks.setSource({ id: 1, x: 16, y: 16 }); b.chunks.update();
    b.chunks.setSource({ id: 1, x: 9000, y: 9000 }); b.chunks.update();
    b.chunks.setSource({ id: 1, x: 16, y: 16 }); b.chunks.update();
    expect(reads).toBe(before + 1);
    await b.chunks.settle(); await new Promise((r) => setTimeout(r, 0));
    expect(b.chunks.getChunk(0, 0)).toBeDefined();
    expect([...b.world.query([Crate])]).toHaveLength(1);
    expect(b.chunks.stats.asyncDropped).toBeGreaterThanOrEqual(2);
    await s2.close();
  });

  it("batches are atomic transactions; queued rows are readable before commit", async () => {
    const factory = new IDBFactory();
    const s = await open(factory);
    const row = (k: string, n: number): StoredChunk => ({ key: k as StoredChunk["key"], format: 1, bytes: new Uint8Array([n]), tick: n });
    const ok = s.openBatch(); ok.append({ chunks: [row("1,1", 1)] });
    expect(s.readChunk("1,1")?.bytes[0]).toBe(1); // read-your-writes before commit
    ok.append({ chunks: [row("1,2", 2)], players: [{ token: "t", name: "n", format: PLAYER_VERSION, bytes: new Uint8Array([5]), tick: 0 }], blobs: [{ key: "x", format: 1, bytes: new Uint8Array([7]), tick: 0 }] });
    await ok.commit();
    // a batch with an uncloneable value fails as a whole
    const bad = s.openBatch(); bad.append({ chunks: [row("2,2", 3)] });
    bad.append({ chunks: [{ ...row("2,3", 4), bytes: (() => 0) as unknown as Uint8Array }] });
    await expect(bad.commit()).rejects.toThrow();
    expect(s.readChunk("2,2")).toBeUndefined();
    await s.write({ deleteChunks: ["1,1"] });
    await s.close();
    const s2 = await open(factory);
    expect(await s2.readChunkAsync("1,1")).toBeUndefined();
    expect((await s2.readChunkAsync("1,2"))?.bytes[0]).toBe(2);
    expect(await s2.readChunkAsync("2,2")).toBeUndefined(); // atomic: the good half of the failed batch is absent
    expect(s2.readPlayer("t")?.bytes[0]).toBe(5); expect(s2.readBlob("x")?.bytes[0]).toBe(7);
    await s2.prefetchChunks(["1,2"]); expect(s2.readChunk("1,2")?.tick).toBe(2);
    expect(s2.count("chunks")).toBe(1);
    await s2.close();
    await IndexedDbWorldStore.delete("world", { factory });
    const s3 = await open(factory); expect(s3.count("chunks")).toBe(0); await s3.close();
  });
});
