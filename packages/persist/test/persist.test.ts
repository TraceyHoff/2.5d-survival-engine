import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Transform, entityIndex } from "@engine/core";
import { installGameplay, spawnPlayer, Health, Survival, PlayerIntent } from "@engine/gameplay";
import { World } from "@engine/core";
import { SqliteWorldStore } from "../src/node.js";
import { WorldPersistence, MemoryWorldStore, encodePlayer, decodePlayerInto, IndexedDbWorldStore, tokenToWords, wordsToToken, nameToWords, wordsToName, tokenToHex } from "../src/index.js";
import { Crate, PIECES, buildBase, makeWorld, spawnCrate, step } from "./helpers.js";

const WorldPersistenceCoords = (k: string): { cx: number; cy: number } => WorldPersistence.coords(k);
const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "persist-")); dirs.push(d); return join(d, "world.db"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("chunk round trip", () => {
  it("saves and reloads a chunk with a 3000-piece base, tiles and persistent entities (SQLite, worker writer)", async () => {
    const path = tmp();
    const s1 = await SqliteWorldStore.open(path);
    const a = makeWorld(s1);
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    expect(a.chunks.getChunk(0, 0)).toBeDefined();
    const t0 = performance.now(); const placed = buildBase(a.buildings, 0, 0, 3000); const placeMs = performance.now() - t0;
    expect(placed).toBe(3000);
    a.chunks.setTile(5, 6, 99);
    const crates = [spawnCrate(a.world, 3.25, 4.5, 7), spawnCrate(a.world, 30.75, 1.125, 9)];
    step(a.world);
    expect(a.persist.isDirty("0,0")).toBe(true);
    const e0 = performance.now(); const saved = await a.persist.saveAll(); const saveMs = performance.now() - e0;
    expect(saved.chunks).toBe(1);
    const row = s1.readChunk("0,0")!; expect(row.format).toBe(1);
    console.log(`[bench] 3000-piece chunk: place ${placeMs.toFixed(1)} ms, encode+commit ${saveMs.toFixed(1)} ms, ${row.bytes.length} bytes`);
    expect(a.world.isAlive(crates[0]!)).toBe(true);
    await s1.close();

    // Fresh process: new world + new store on the same file.
    const s2 = await SqliteWorldStore.open(path);
    expect(s2.count("chunks")).toBe(1);
    const b = makeWorld(s2);
    b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    expect(b.persist.stats.chunksLoadedFromStore).toBe(1);
    expect(b.buildings.count).toBe(3000);
    expect(b.chunks.getTile(5, 6)).toBe(99);
    const wall = PIECES.byKey("wall").id;
    const id = b.buildings.at(23, 29, 2, 1); const inst = b.buildings.get(id)!; // piece #2999
    expect(inst).toMatchObject({ piece: wall, tx: 23, ty: 29, z: 2 });
    const orig = a.buildings.get(a.buildings.at(23, 29, 2, 1))!;
    expect(inst.rot).toBe(orig.rot); expect(inst.hp).toBe(orig.hp);
    const loaded = [...b.world.query([Crate])].map((e) => ({ ...b.world.get(e, Transform)!, ...b.world.get(e, Crate)! })).sort((p, q) => p.loot - q.loot);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({ x: 3.25, y: 4.5, loot: 7, hp: 10.5 });
    expect(loaded[1]).toMatchObject({ x: 30.75, y: 1.125, loot: 9 });
    // Loading did not make the chunk dirty again.
    step(b.world, 2); expect(b.persist.isDirty("0,0")).toBe(false);
    await s2.close();
  });

  it("only stores chunks that changed; unload saves and evicts; reload restores", async () => {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { loadRadius: 1 });
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    expect(a.chunks.chunkCount).toBe(9);
    a.chunks.setTile(40, 2, 77); // chunk 1,0
    const crate = spawnCrate(a.world, 41, 3, 5); step(a.world);
    a.buildings.place(PIECES.byKey("foundation").id, -5, -5, 0); // chunk -1,-1
    // move away: everything unloads (cacheSize 0)
    a.chunks.setSource({ id: 1, x: 5000, y: 5000 }); step(a.world);
    expect(a.persist.stats.chunksSavedOnUnload).toBe(2);
    expect(store.count("chunks")).toBe(2);
    expect(a.world.isAlive(crate)).toBe(false);
    expect(a.buildings.count).toBe(0);
    await store.flush();
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    expect(a.chunks.getTile(40, 2)).toBe(77);
    expect([...a.world.query([Crate])]).toHaveLength(1);
    expect(a.buildings.at(-5, -5, 0, 0)).not.toBe(0);
  });

  it("re-encodes an entity that moved across chunks during a running round (no duplicates)", async () => {
    const store = new MemoryWorldStore();
    const a = makeWorld(store, { loadRadius: 1, encodeBudgetMs: 0 }); // one chunk per tick
    a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) a.chunks.setTile(cx * 32 + 1, cy * 32 + 1, 50);
    const c = spawnCrate(a.world, 16, 16, 1); step(a.world);
    expect(a.persist.beginRound()).toBe(true);
    while (!store.readChunk("0,0")) step(a.world); // encoded chunk by chunk; stop right after 0,0 (with the crate)
    expect(a.persist.roundInProgress).toBe(true);
    const done = ["-1,-1", "0,-1", "1,-1", "-1,0", "1,0", "-1,1", "0,1", "1,1"].find((k) => store.readChunk(k));
    const dest = done ? WorldPersistenceCoords(done) : { cx: 1, cy: 1 };
    a.world.set(c, Transform, { x: dest.cx * 32 + 8, y: dest.cy * 32 + 8 }); // into an already-encoded chunk if possible
    step(a.world, 12); await store.flush();
    expect(a.persist.roundInProgress).toBe(false);
    const b = makeWorld(store, { loadRadius: 1 }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    const all = [...b.world.query([Crate])]; expect(all).toHaveLength(1);
    expect(b.world.get(all[0]!, Transform)).toMatchObject({ x: dest.cx * 32 + 8, y: dest.cy * 32 + 8 });
  });
});

describe("SQLite store", () => {
  it("uses WAL and commits batches atomically (a failing batch leaves nothing behind)", async () => {
    const path = tmp(); const s = await SqliteWorldStore.open(path);
    const raw = new Database(path, { readonly: true });
    expect(raw.pragma("journal_mode", { simple: true })).toBe("wal");
    await s.write({ chunks: [{ key: "1,2", format: 1, bytes: new Uint8Array([1, 2, 3]), tick: 5 }] });
    const bad = s.write({ chunks: [{ key: "3,4", format: 1, bytes: new Uint8Array([9]), tick: 6 }, { key: "1,2", format: 1, bytes: new Uint8Array([7]), tick: 6 }, { key: "broken", format: 1, bytes: new Uint8Array([0]), tick: 6 }] });
    expect(s.readChunk("3,4")).toBeDefined(); // read-your-writes before commit
    await expect(bad).rejects.toThrow(/sqlite write failed/);
    expect(s.readChunk("3,4")).toBeUndefined();
    expect([...s.readChunk("1,2")!.bytes]).toEqual([1, 2, 3]);
    expect(raw.prepare("select count(*) n from chunks").get()).toEqual({ n: 1 });
    raw.close(); await s.close();
  });

  it("multi-part batches commit as one transaction and inline writer works with :memory:", async () => {
    const s = await SqliteWorldStore.open(":memory:", { writer: "inline" });
    const b = s.openBatch();
    b.append({ chunks: [{ key: "0,0", format: 1, bytes: new Uint8Array([1]), tick: 1 }] });
    b.append({ chunks: [{ key: "0,0", format: 1, bytes: new Uint8Array([2]), tick: 2 }], meta: { seed: 9, tick: 2, schemaHash: 123 } });
    expect(s.stats().pendingBatches).toBe(1);
    await b.commit();
    expect([...s.readChunk("0,0")!.bytes]).toEqual([2]);
    expect(s.readMeta()).toEqual({ seed: 9, tick: 2, schemaHash: 123 });
    expect(s.stats()).toMatchObject({ pendingBatches: 0, pendingChunks: 0, committedBatches: 1, committedChunks: 2 });
    await s.close();
  });
});

describe("players", () => {
  it("player record round-trips by component name and skips changed schemas", () => {
    const w = new World({ seed: 1 }); installGameplay(w);
    const p = spawnPlayer(w, { x: 12.5, y: -3.25, clientId: 4 });
    w.setField(p, Health, "hp", 42); w.setField(p, Survival, "hunger", 33);
    const bytes = encodePlayer(w, p, { exclude: [PlayerIntent] });
    const w2 = new World({ seed: 1 }); installGameplay(w2);
    const q = spawnPlayer(w2, { x: 0, y: 0, clientId: 9 });
    const r = decodePlayerInto(w2, q, bytes, { exclude: [PlayerIntent] });
    expect(r.skipped).toEqual([]); expect(r.restored).toContain("Health");
    expect(w2.get(q, Transform)).toMatchObject({ x: 12.5, y: -3.25 });
    expect(w2.getField(q, Health, "hp")).toBe(42); expect(w2.getField(q, Survival, "hunger")).toBeCloseTo(33, 4);
    expect(w2.store(PlayerIntent).has(entityIndex(q))).toBe(true);
  });

  it("session helpers round-trip tokens and names", () => {
    const t = new Uint8Array(16).map((_, i) => i * 17); const hex = tokenToHex(t);
    expect(wordsToToken(tokenToWords(t))).toBe(hex); expect(wordsToToken(tokenToWords(hex))).toBe(hex);
    expect(wordsToName(nameToWords("Ada Lovelace"))).toBe("Ada Lovelace");
    expect(wordsToName(nameToWords("x".repeat(40)))).toBe("x".repeat(32));
    expect(wordsToName(nameToWords("ñandú-🦤-ñandú-🦤-ñandú"))).toMatch(/^ñandú/);
  });

  it("IndexedDB store is an explicit stub", async () => {
    await expect(IndexedDbWorldStore.open("x")).rejects.toThrow();
    expect(new IndexedDbWorldStore("x").readChunk("0,0")).toBeUndefined();
  });
});
