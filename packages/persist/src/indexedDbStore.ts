import type { ChunkKey } from "@engine/world";
import { emptyStats, type BatchHandle, type SaveBatch, type StoredChunk, type StoredPlayer, type StoreStats, type WorldMeta, type WorldStore } from "./types.js";

/**
 * STUB: IndexedDB backend for a browser-hosted listen server. Not implemented yet; this pins down the shape.
 *
 * Planned design (same tables as SQLite):
 *  - object stores `chunks` (keyPath "key"), `players` (keyPath "token"), `meta` (single record "world").
 *  - write(batch) = ONE readwrite transaction over the stores it touches (atomic like the SQLite batch); resolves on
 *    `oncomplete`. Pending rows stay in `overlay` until then, so reads see them immediately.
 *  - reads are async in IndexedDB but `ChunkProvider.load` is sync, so the host calls `prefetchChunks(keys)` for the
 *    ring just outside ChunkManager's load radius and `readChunk` answers from `cache`. A miss falls back to the
 *    generator; to avoid generating over a saved chunk the host must prefetch before the chunk becomes active
 *    (or ChunkManager needs an async provider; see open question in docs/ARCHITECTURE.md §9.5).
 *  - `open()` reads `meta` and all `players` up front (small).
 */
export class IndexedDbWorldStore implements WorldStore {
  readonly kind = "indexeddb";
  private cache = new Map<ChunkKey, StoredChunk>();
  private overlay = new Map<ChunkKey, StoredChunk>();
  constructor(readonly dbName: string) {}
  static async open(dbName: string): Promise<IndexedDbWorldStore> {
    if (typeof (globalThis as { indexedDB?: unknown }).indexedDB === "undefined") throw new Error("IndexedDB not available");
    throw new Error(`IndexedDbWorldStore(${dbName}): not implemented yet (stub)`);
  }
  readMeta(): WorldMeta | undefined { return undefined; }
  readChunk(key: ChunkKey): StoredChunk | undefined { return this.overlay.get(key) ?? this.cache.get(key); }
  readPlayer(_token: string): StoredPlayer | undefined { return undefined; }
  prefetchChunks(_keys: readonly ChunkKey[]): Promise<void> { return Promise.reject(new Error("IndexedDbWorldStore: not implemented")); }
  write(_batch: SaveBatch): Promise<void> { return Promise.reject(new Error("IndexedDbWorldStore: not implemented")); }
  openBatch(): BatchHandle { return { append: () => { throw new Error("IndexedDbWorldStore: not implemented"); }, commit: () => this.write({}) }; }
  flush(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
  stats(): StoreStats { return emptyStats(); }
  count(_t: "chunks" | "players"): number { return 0; }
}
