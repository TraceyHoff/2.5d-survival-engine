import type { ChunkKey } from "@engine/world";
import { emptyStats, type BatchHandle, type SaveBatch, type StoredChunk, type StoredPlayer, type StoreStats, type WorldMeta, type WorldStore } from "./types.js";

/** In-memory WorldStore (tests, throwaway listen servers). Batches commit on a microtask, atomically. */
export class MemoryWorldStore implements WorldStore {
  readonly kind = "memory";
  private chunks = new Map<ChunkKey, StoredChunk>();
  private players = new Map<string, StoredPlayer>();
  private meta: WorldMeta | undefined;
  private tail: Promise<void> = Promise.resolve();
  private s: StoreStats = emptyStats();
  readMeta(): WorldMeta | undefined { return this.meta; }
  readChunk(key: ChunkKey): StoredChunk | undefined { return this.chunks.get(key); }
  readPlayer(token: string): StoredPlayer | undefined { return this.players.get(token); }
  write(b: SaveBatch): Promise<void> {
    // Apply to the visible maps immediately (read-your-writes); count the commit asynchronously.
    for (const c of b.chunks ?? []) this.chunks.set(c.key, c);
    for (const k of b.deleteChunks ?? []) this.chunks.delete(k);
    for (const p of b.players ?? []) this.players.set(p.token, p);
    if (b.meta) this.meta = { ...b.meta };
    this.s.pendingBatches++;
    this.tail = this.tail.then(() => {
      this.s.pendingBatches--; this.s.committedBatches++;
      this.s.committedChunks += b.chunks?.length ?? 0; this.s.committedPlayers += b.players?.length ?? 0;
      for (const c of b.chunks ?? []) this.s.bytesWritten += c.bytes.length;
    });
    return this.tail;
  }
  openBatch(): BatchHandle {
    const parts: SaveBatch[] = []; this.s.pendingBatches++;
    return {
      append: (b) => { parts.push(b); for (const c of b.chunks ?? []) this.chunks.set(c.key, c); for (const p of b.players ?? []) this.players.set(p.token, p); for (const k of b.deleteChunks ?? []) this.chunks.delete(k); if (b.meta) this.meta = { ...b.meta }; },
      commit: () => { this.s.pendingBatches--; return this.write({}).then(() => { this.s.committedBatches--; for (const b of parts) { this.s.committedChunks += b.chunks?.length ?? 0; this.s.committedPlayers += b.players?.length ?? 0; } this.s.committedBatches++; }); },
    };
  }
  flush(): Promise<void> { return this.tail; }
  async close(): Promise<void> { await this.tail; }
  stats(): StoreStats { return { ...this.s }; }
  count(t: "chunks" | "players"): number { return t === "chunks" ? this.chunks.size : this.players.size; }
}
