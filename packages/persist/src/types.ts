import type { ChunkKey } from "@engine/world";

/** One saved chunk row. `format` = the chunk codec version stored in the blob header (encodeChunk). */
export interface StoredChunk { key: ChunkKey; format: number; bytes: Uint8Array; tick: number }
/** One saved player row, keyed by the account/session token (hex). `format` = player record version. */
export interface StoredPlayer { token: string; name: string; format: number; bytes: Uint8Array; tick: number }
/**
 * World-level record that is not per chunk or per player (blobs table), e.g. "groups" (core GroupRegistry format)
 * and "claims" (persist claim format). `format` = the record's own version byte.
 */
export interface StoredBlob { key: string; format: number; bytes: Uint8Array; tick: number }
/** World-level metadata (meta table). */
export interface WorldMeta { seed: number; tick: number; schemaHash: number; createdAt?: number; /** Next account PlayerId to hand out. */ nextPlayerId?: number }

/** Everything written in one transaction. Either all of it becomes durable or none of it does. */
export interface SaveBatch {
  chunks?: StoredChunk[];
  players?: StoredPlayer[];
  meta?: WorldMeta;
  /** World-level records (upsert by key). */
  blobs?: StoredBlob[];
  /** Chunk keys to delete (e.g. a world reset of an area). */
  deleteChunks?: ChunkKey[];
}

export interface StoreStats {
  /** Batches handed to write() that have not committed yet. */
  pendingBatches: number;
  /** Rows waiting in the read-through overlay (written but not committed yet). */
  pendingChunks: number;
  committedBatches: number;
  committedChunks: number;
  committedPlayers: number;
  bytesWritten: number;
  /** Wall-clock ms the backend spent committing the last batch (worker side for SQLite). */
  lastCommitMs: number;
}

/**
 * Storage backend for a world. Meta, blobs and players are read SYNCHRONOUSLY (backends without sync I/O load them
 * at open). Chunks are read synchronously (`readChunk`, SQLite / memory) or asynchronously (`readChunkAsync`,
 * IndexedDB), which WorldPersistence turns into a sync `ChunkProvider` or core's `AsyncChunkProvider`.
 * Writes are asynchronous, batched and transactional.
 *
 * Read-your-writes: a row passed to write() must be returned by the read methods immediately, even before the
 * batch commits (implementations keep a pending overlay).
 */
export interface WorldStore {
  readonly kind: string;
  readMeta(): WorldMeta | undefined;
  /** Sync chunk read. Async-only backends answer from their pending overlay / cache and may miss. */
  readChunk(key: ChunkKey): StoredChunk | undefined;
  /** Present on backends whose chunk reads are asynchronous: the authoritative read (overlay, then disk). */
  readChunkAsync?(key: ChunkKey): Promise<StoredChunk | undefined>;
  /** Async backends that know their key set: false = definitely no row (load from the generator synchronously). */
  hasChunk?(key: ChunkKey): boolean;
  readPlayer(token: string): StoredPlayer | undefined;
  readBlob(key: string): StoredBlob | undefined;
  /** Optional async warm-up for backends without synchronous reads. */
  prefetchChunks?(keys: readonly ChunkKey[]): Promise<void>;
  /** Queue one transactional batch. Resolves when committed. Never blocks the caller on I/O. */
  write(batch: SaveBatch): Promise<void>;
  /** Start a multi-part transaction (see BatchHandle). */
  openBatch(): BatchHandle;
  /** Resolves when every batch queued so far is committed. */
  flush(): Promise<void>;
  /** Flush, then release the backend. */
  close(): Promise<void>;
  stats(): StoreStats;
  /** Number of chunk / player rows stored (diagnostics, tests). */
  count(table: "chunks" | "players"): number;
}

export function emptyStats(): StoreStats {
  return { pendingBatches: 0, pendingChunks: 0, committedBatches: 0, committedChunks: 0, committedPlayers: 0, bytesWritten: 0, lastCommitMs: 0 };
}

/** Hex encoding for 16-byte tokens (stable row key, safe for localStorage). */
export function tokenToHex(t: Uint8Array): string { let s = ""; for (const b of t) s += b.toString(16).padStart(2, "0"); return s; }
export function hexToToken(h: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(h)) throw new Error("bad token hex");
  const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return out;
}
/** Reads the chunk codec version from an encodeChunk blob header (u32 magic, u16 version). */
export function chunkFormatOf(bytes: Uint8Array): number { return bytes.length >= 6 ? bytes[4]! | (bytes[5]! << 8) : 0; }

/**
 * A transaction assembled over several calls (e.g. one autosave round encoded across many ticks). Parts become
 * readable through the store immediately; nothing is durable until commit() resolves, and then all of it is.
 */
export interface BatchHandle {
  append(part: SaveBatch): void;
  commit(): Promise<void>;
}
