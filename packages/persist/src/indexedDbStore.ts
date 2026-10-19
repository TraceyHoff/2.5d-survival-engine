import type { ChunkKey } from "@engine/world";
import { emptyStats, recordKey, RecordTable, type RecordQuery, type StoredRecord, type BatchHandle, type SaveBatch, type StoredBlob, type StoredChunk, type StoredPlayer, type StoreStats, type WorldMeta, type WorldStore } from "./types.js";

/** v2 adds the `records` object store (upgrade creates it; v1 databases keep their data). */
export const IDB_SCHEMA_VERSION = 2;
/*
 * Minimal structural IndexedDB types (persist is also typechecked by Node-only packages without the DOM lib).
 * The browser's indexedDB and fake-indexeddb's IDBFactory both satisfy them.
 */
interface IdbRequest<T = unknown> { result: T; error: unknown; onsuccess: ((ev: unknown) => void) | null; onerror: ((ev: unknown) => void) | null }
interface IdbOpenRequest extends IdbRequest<IdbDatabase> { onupgradeneeded: ((ev: unknown) => void) | null }
interface IdbStore {
  get(key: string): IdbRequest; getAll(): IdbRequest<unknown[]>; getAllKeys(): IdbRequest<unknown[]>;
  put(value: unknown, key?: string): IdbRequest; delete(key: string | string[]): IdbRequest;
}
interface IdbTransaction { objectStore(name: string): IdbStore; abort(): void; error: unknown; oncomplete: ((ev: unknown) => void) | null; onabort: ((ev: unknown) => void) | null; onerror: ((ev: { preventDefault?: () => void }) => void) | null }
interface IdbDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, opts?: { keyPath?: string | string[] }): unknown;
  transaction(stores: string | string[], mode: "readonly" | "readwrite"): IdbTransaction;
  close(): void;
}
export interface IdbFactoryLike { open(name: string, version?: number): IdbOpenRequest; deleteDatabase(name: string): IdbRequest }

const STORES = ["chunks", "players", "meta", "blobs", "records"] as const;

export interface IndexedDbStoreOptions {
  /** IDBFactory to use (default globalThis.indexedDB; tests pass fake-indexeddb's). */
  factory?: IdbFactoryLike;
}

interface Pending { parts: SaveBatch[]; committed: boolean; done: Promise<void>; resolve: () => void; reject: (e: Error) => void }

const req = <T>(r: IdbRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error ?? new Error("IndexedDB request failed")); });
const bytesOf = (b: unknown): Uint8Array => b instanceof Uint8Array ? b : new Uint8Array(b as ArrayBuffer);

/**
 * IndexedDB backend for a browser-hosted listen server. Same tables as SQLite: object stores `chunks` (key),
 * `players` (token), `blobs` (key) and `meta` (single record "world").
 *
 * - Chunk reads are async (`readChunkAsync`), so WorldPersistence hands ChunkManager core's AsyncChunkProvider
 *   (deduped reads, late results discarded undecoded). `readChunk` answers synchronously from the pending overlay
 *   and the `prefetchChunks` cache only.
 * - Meta, players and blobs are small and loaded at `open()`, so their reads stay synchronous.
 * - Each batch (write() or openBatch()...commit()) is ONE readwrite transaction over all stores: all or nothing.
 *   Commits are serialized in submission order. Rows are readable from the overlay as soon as they are queued.
 */
export class IndexedDbWorldStore implements WorldStore {
  readonly kind = "indexeddb";
  private cache = new Map<ChunkKey, StoredChunk>();
  private overlay = new Map<ChunkKey, StoredChunk | null>(); // null = pending delete
  private players = new Map<string, StoredPlayer>();
  private overlayPlayers = new Map<string, StoredPlayer>();
  private blobs = new Map<string, StoredBlob>();
  private overlayBlobs = new Map<string, StoredBlob>();
  private records = new RecordTable();
  private meta: WorldMeta | undefined;
  private overlayMeta: WorldMeta | undefined;
  private chunkKeys = new Set<ChunkKey>();
  private pending = new Set<Pending>();
  private tail: Promise<void> = Promise.resolve();
  private s: StoreStats = emptyStats();
  private closed = false;

  private constructor(readonly dbName: string, private readonly db: IdbDatabase) {}

  static async open(dbName: string, opts: IndexedDbStoreOptions = {}): Promise<IndexedDbWorldStore> {
    const f = opts.factory ?? (globalThis as { indexedDB?: IdbFactoryLike }).indexedDB;
    if (!f) throw new Error("IndexedDB not available");
    const open = f.open(dbName, IDB_SCHEMA_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: "key" });
      if (!db.objectStoreNames.contains("players")) db.createObjectStore("players", { keyPath: "token" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      // v2: generic records, keyed [ns, id] (loaded at open like players/blobs).
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: ["ns", "id"] });
    };
    const db = await req(open);
    const st = new IndexedDbWorldStore(dbName, db);
    const tx = db.transaction([...STORES], "readonly");
    const [players, blobs, meta, keys, records] = await Promise.all([
      req(tx.objectStore("players").getAll()) as Promise<StoredPlayer[]>,
      req(tx.objectStore("blobs").getAll()) as Promise<StoredBlob[]>,
      req(tx.objectStore("meta").get("world")) as Promise<WorldMeta | undefined>,
      req(tx.objectStore("chunks").getAllKeys()) as Promise<unknown[]>,
      req(tx.objectStore("records").getAll()) as Promise<StoredRecord[]>,
    ]);
    for (const r of records) st.records.rows.set(recordKey(r.ns, r.id), { ...r, bytes: bytesOf(r.bytes) });
    for (const p of players) st.players.set(p.token, { ...p, bytes: bytesOf(p.bytes) });
    for (const b of blobs) st.blobs.set(b.key, { ...b, bytes: bytesOf(b.bytes) });
    st.meta = meta; for (const k of keys) st.chunkKeys.add(String(k) as ChunkKey);
    return st;
  }

  readMeta(): WorldMeta | undefined { const m = this.overlayMeta ?? this.meta; return m ? { ...m } : undefined; }
  readChunk(key: ChunkKey): StoredChunk | undefined {
    const o = this.overlay.get(key); if (o !== undefined) return o ?? undefined;
    return this.cache.get(key);
  }
  async readChunkAsync(key: ChunkKey): Promise<StoredChunk | undefined> {
    const o = this.overlay.get(key); if (o !== undefined) return o ?? undefined;
    const c = this.cache.get(key); if (c) return c;
    if (!this.chunkKeys.has(key) || this.closed) return undefined;
    const r = await req(this.db.transaction("chunks", "readonly").objectStore("chunks").get(key)) as StoredChunk | undefined;
    // A write queued while the read was in flight wins.
    const o2 = this.overlay.get(key); if (o2 !== undefined) return o2 ?? undefined;
    return r ? { ...r, bytes: bytesOf(r.bytes) } : undefined;
  }
  hasChunk(key: ChunkKey): boolean { const o = this.overlay.get(key); return o !== undefined ? o !== null : this.chunkKeys.has(key); }
  readPlayer(token: string): StoredPlayer | undefined { return this.overlayPlayers.get(token) ?? this.players.get(token); }
  readBlob(key: string): StoredBlob | undefined { return this.overlayBlobs.get(key) ?? this.blobs.get(key); }
  readRecord(ns: string, id: string): StoredRecord | undefined { return this.records.get(ns, id); }
  listRecords(ns: string, q?: RecordQuery): StoredRecord[] { return this.records.list(ns, q); }
  /** Loads rows into the sync cache (e.g. the ring just outside the load radius). */
  async prefetchChunks(keys: readonly ChunkKey[]): Promise<void> {
    await Promise.all(keys.map(async (k) => { if (this.cache.has(k)) return; const r = await this.readChunkAsync(k); if (r && !this.overlay.has(k)) this.cache.set(k, r); }));
  }
  /** Drops prefetched rows (they are re-read on demand). */
  evictCache(keys?: readonly ChunkKey[]): void { if (!keys) this.cache.clear(); else for (const k of keys) this.cache.delete(k); }
  count(t: "chunks" | "players" | "records"): number {
    if (t === "records") return this.records.count();
    if (t === "players") { const s = new Set([...this.players.keys(), ...this.overlayPlayers.keys()]); return s.size; }
    const s = new Set(this.chunkKeys); for (const [k, v] of this.overlay) { if (v) s.add(k); else s.delete(k); } return s.size;
  }

  openBatch(): BatchHandle {
    if (this.closed) throw new Error("store closed");
    const rec = { parts: [], committed: false } as unknown as Pending;
    rec.done = new Promise<void>((res, rej) => { rec.resolve = res; rec.reject = rej; }); rec.done.catch(() => undefined);
    this.pending.add(rec);
    return {
      append: (part) => {
        if (rec.committed) throw new Error("batch already committed");
        rec.parts.push(part);
        for (const c of part.chunks ?? []) this.overlay.set(c.key, c);
        for (const k of part.deleteChunks ?? []) this.overlay.set(k, null);
        for (const p of part.players ?? []) this.overlayPlayers.set(p.token, p);
        for (const b of part.blobs ?? []) this.overlayBlobs.set(b.key, b);
        this.records.stage(part);
        if (part.meta) this.overlayMeta = { ...part.meta };
      },
      commit: () => { if (!rec.committed) { rec.committed = true; this.tail = this.tail.then(() => this.commit(rec)); } return rec.done; },
    };
  }
  write(batch: SaveBatch): Promise<void> { if (this.closed) return Promise.reject(new Error("store closed")); const b = this.openBatch(); b.append(batch); return b.commit(); }

  private commit(rec: Pending): Promise<void> {
    const t0 = performance.now();
    return new Promise<void>((resolve) => {
      let bytes = 0, chunks = 0, players = 0;
      let tx: IdbTransaction;
      try { tx = this.db.transaction([...STORES], "readwrite"); } catch (e) { this.settle(rec, e instanceof Error ? e : new Error(String(e))); resolve(); return; }
      const cs = tx.objectStore("chunks"), ps = tx.objectStore("players"), bs = tx.objectStore("blobs"), ms = tx.objectStore("meta"), rs = tx.objectStore("records");
      try {
        for (const part of rec.parts) {
          for (const k of part.deleteChunks ?? []) cs.delete(k);
          for (const c of part.chunks ?? []) { cs.put({ key: c.key, format: c.format, bytes: c.bytes, tick: c.tick }); bytes += c.bytes.length; chunks++; }
          for (const p of part.players ?? []) { ps.put({ token: p.token, name: p.name, format: p.format, bytes: p.bytes, tick: p.tick }); bytes += p.bytes.length; players++; }
          for (const b of part.blobs ?? []) { bs.put({ key: b.key, format: b.format, bytes: b.bytes, tick: b.tick }); bytes += b.bytes.length; }
          for (const d of part.deleteRecords ?? []) rs.delete([d.ns, d.id]);
          for (const r of part.records ?? []) { rs.put({ ns: r.ns, id: r.id, format: r.format, bytes: r.bytes, tick: r.tick, ownerKind: r.ownerKind, ownerId: r.ownerId, chunk: r.chunk }); bytes += r.bytes.length; }
          if (part.meta) ms.put({ ...part.meta }, "world");
        }
      } catch (e) { try { tx.abort(); } catch { /* already finished */ } this.settle(rec, e instanceof Error ? e : new Error(String(e))); resolve(); return; }
      tx.oncomplete = () => { this.settle(rec, undefined, { bytes, chunks, players, ms: performance.now() - t0 }); resolve(); };
      const fail = (): void => { this.settle(rec, new Error(`IndexedDB write failed: ${String(tx.error ?? "aborted")}`)); resolve(); };
      tx.onabort = fail; tx.onerror = (ev) => { ev.preventDefault?.(); };
    });
  }
  private settled = new WeakSet<Pending>();
  private settle(rec: Pending, err: Error | undefined, m?: { bytes: number; chunks: number; players: number; ms: number }): void {
    if (this.settled.has(rec)) return; this.settled.add(rec); this.pending.delete(rec);
    for (const part of rec.parts) {
      for (const c of part.chunks ?? []) { if (!err) { this.chunkKeys.add(c.key); if (this.cache.has(c.key)) this.cache.set(c.key, c); } if (this.overlay.get(c.key) === c) this.overlay.delete(c.key); }
      for (const k of part.deleteChunks ?? []) { if (!err) { this.chunkKeys.delete(k); this.cache.delete(k); } if (this.overlay.get(k) === null && !this.laterTouches(k)) this.overlay.delete(k); }
      for (const p of part.players ?? []) { if (!err) this.players.set(p.token, p); if (this.overlayPlayers.get(p.token) === p) this.overlayPlayers.delete(p.token); }
      for (const b of part.blobs ?? []) { if (!err) this.blobs.set(b.key, b); if (this.overlayBlobs.get(b.key) === b) this.overlayBlobs.delete(b.key); }
      this.records.settle(part, !err);
      if (part.meta && !err) this.meta = { ...part.meta };
    }
    if (!this.pending.size) this.overlayMeta = undefined;
    if (err) { rec.reject(err); return; }
    this.s.committedBatches++; this.s.committedChunks += m!.chunks; this.s.committedPlayers += m!.players; this.s.bytesWritten += m!.bytes; this.s.lastCommitMs = m!.ms;
    rec.resolve();
  }
  private laterTouches(k: ChunkKey): boolean { for (const p of this.pending) for (const part of p.parts) if (part.deleteChunks?.includes(k)) return true; return false; }

  /** Waits for every batch committed so far (open, uncommitted batches are not waited for). */
  async flush(): Promise<void> { await this.tail; }
  async close(): Promise<void> {
    if (this.closed) return;
    for (const p of [...this.pending]) if (!p.committed) { p.committed = true; this.tail = this.tail.then(() => this.commit(p)); }
    await this.flush(); this.closed = true; this.db.close();
  }
  stats(): StoreStats { return { ...this.s, pendingBatches: this.pending.size, pendingChunks: this.overlay.size }; }

  /** Deletes a saved world (e.g. "new world" in a browser host). */
  static delete(dbName: string, opts: IndexedDbStoreOptions = {}): Promise<void> {
    const f = opts.factory ?? (globalThis as { indexedDB?: IdbFactoryLike }).indexedDB; if (!f) return Promise.reject(new Error("IndexedDB not available"));
    return req(f.deleteDatabase(dbName)).then(() => undefined);
  }
}
