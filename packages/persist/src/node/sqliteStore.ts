/** Node-only SQLite backend (better-sqlite3). Import via "@engine/persist/node". */
import Database from "better-sqlite3";
import { Worker } from "node:worker_threads";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChunkKey } from "@engine/world";
import { emptyStats, type BatchHandle, type SaveBatch, type StoredChunk, type StoredPlayer, type StoreStats, type WorldMeta, type WorldStore } from "../types.js";

export const SQLITE_SCHEMA_VERSION = 1;
const DDL = `
CREATE TABLE IF NOT EXISTS chunks (
  key TEXT PRIMARY KEY,            -- "cx,cy" (ChunkKey)
  cx INTEGER NOT NULL, cy INTEGER NOT NULL,
  format INTEGER NOT NULL,         -- chunk codec version (encodeChunk header)
  data BLOB NOT NULL,
  updated_tick INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS players (
  token TEXT PRIMARY KEY,          -- account/session token (hex)
  name TEXT NOT NULL DEFAULT '',
  format INTEGER NOT NULL,         -- player record version
  data BLOB NOT NULL,
  updated_tick INTEGER NOT NULL,
  updated_at INTEGER NOT NULL      -- wall clock ms (diagnostics only)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
`;

export interface SqliteStoreOptions {
  /** "worker" (default): commits run on a worker thread. "inline": batched commits on the main thread via setImmediate (fallback/tests). */
  writer?: "worker" | "inline";
  /** WAL synchronous level. NORMAL (default) never corrupts; a power loss may drop the newest commits. FULL fsyncs every commit. */
  synchronous?: "NORMAL" | "FULL";
}

interface Pending { resolve: () => void; reject: (e: Error) => void; chunks: StoredChunk[]; players: StoredPlayer[]; done: Promise<void>; committed: boolean }

/**
 * WorldStore over SQLite (WAL). Main thread: one connection for synchronous reads (chunk loads must be sync for
 * ChunkManager) plus a read-through overlay of rows that were queued but not committed yet. Writes go to a worker
 * thread as transactional batches; the main thread only pays the structured-clone copy of the bytes it posts.
 */
export class SqliteWorldStore implements WorldStore {
  readonly kind = "sqlite";
  private db: Database.Database;
  private worker: Worker | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private overlayChunks = new Map<ChunkKey, StoredChunk>();
  private overlayPlayers = new Map<string, StoredPlayer>();
  private overlayMeta: WorldMeta | undefined;
  private inlineParts = new Map<number, SaveBatch[]>();
  private s: StoreStats = emptyStats();
  private closed = false;
  private qChunk; private qPlayer; private qMeta; private qCount;

  private constructor(readonly path: string, private readonly opts: SqliteStoreOptions) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma(`synchronous = ${opts.synchronous ?? "NORMAL"}`);
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(DDL);
    const v = this.db.pragma("user_version", { simple: true }) as number;
    if (v > SQLITE_SCHEMA_VERSION) throw new Error(`save ${path} has schema v${v}, this build supports v${SQLITE_SCHEMA_VERSION}`);
    if (v < SQLITE_SCHEMA_VERSION) this.db.pragma(`user_version = ${SQLITE_SCHEMA_VERSION}`);
    this.qChunk = this.db.prepare<[string], { format: number; data: Buffer; updated_tick: number }>("SELECT format, data, updated_tick FROM chunks WHERE key = ?");
    this.qPlayer = this.db.prepare<[string], { name: string; format: number; data: Buffer; updated_tick: number }>("SELECT name, format, data, updated_tick FROM players WHERE token = ?");
    this.qMeta = this.db.prepare<[], { k: string; v: string }>("SELECT k, v FROM meta");
    this.qCount = { chunks: this.db.prepare<[], { n: number }>("SELECT count(*) AS n FROM chunks"), players: this.db.prepare<[], { n: number }>("SELECT count(*) AS n FROM players") };
  }

  /** Opens (creating if needed) a save file. `:memory:` is only valid with writer "inline". */
  static async open(path: string, opts: SqliteStoreOptions = {}): Promise<SqliteWorldStore> {
    if (path === ":memory:" && opts.writer !== "inline") throw new Error(":memory: needs writer: 'inline' (a worker cannot share it)");
    const st = new SqliteWorldStore(path, opts);
    if ((opts.writer ?? "worker") === "worker") await st.startWorker();
    return st;
  }

  private startWorker(): Promise<void> {
    const w = new Worker(new URL("./sqlite-worker.mjs", import.meta.url), { workerData: { path: this.path, synchronous: this.opts.synchronous ?? "NORMAL" } });
    this.worker = w;
    w.on("message", (m: { type: string; id?: number; ms?: number; bytes?: number; chunks?: number; players?: number; message?: string }) => {
      if (m.type === "done" || m.type === "error") this.settle(m.id!, m.type === "error" ? new Error(`sqlite write failed: ${m.message}`) : undefined, m);
    });
    w.on("error", (e) => { for (const id of [...this.pending.keys()]) this.settle(id, e); });
    w.unref();
    return new Promise((resolve, reject) => {
      const onMsg = (m: { type: string }) => { if (m.type === "ready") { w.off("message", onMsg); resolve(); } };
      w.on("message", onMsg); w.once("error", reject);
    });
  }

  private settle(id: number, err: Error | undefined, m?: { ms?: number; bytes?: number; chunks?: number; players?: number }): void {
    const p = this.pending.get(id); if (!p) return; this.pending.delete(id);
    // Drop overlay rows that this batch made durable (unless a newer, still pending write replaced them).
    for (const c of p.chunks) if (this.overlayChunks.get(c.key) === c) this.overlayChunks.delete(c.key);
    for (const pl of p.players) if (this.overlayPlayers.get(pl.token) === pl) this.overlayPlayers.delete(pl.token);
    if (!this.pending.size) this.overlayMeta = undefined;
    if (err) { p.reject(err); return; }
    this.s.committedBatches++; this.s.committedChunks += m?.chunks ?? 0; this.s.committedPlayers += m?.players ?? 0;
    this.s.bytesWritten += m?.bytes ?? 0; this.s.lastCommitMs = m?.ms ?? 0;
    p.resolve();
  }

  readMeta(): WorldMeta | undefined {
    if (this.overlayMeta) return { ...this.overlayMeta };
    const rows = this.qMeta.all(); if (!rows.length) return undefined;
    const m = Object.fromEntries(rows.map((r) => [r.k, Number(r.v)]));
    return { seed: m["seed"] ?? 0, tick: m["tick"] ?? 0, schemaHash: m["schemaHash"] ?? 0, ...(m["createdAt"] !== undefined ? { createdAt: m["createdAt"] } : {}) };
  }
  readChunk(key: ChunkKey): StoredChunk | undefined {
    const o = this.overlayChunks.get(key); if (o) return o;
    const r = this.qChunk.get(key); return r ? { key, format: r.format, bytes: r.data, tick: r.updated_tick } : undefined;
  }
  readPlayer(token: string): StoredPlayer | undefined {
    const o = this.overlayPlayers.get(token); if (o) return o;
    const r = this.qPlayer.get(token); return r ? { token, name: r.name, format: r.format, bytes: r.data, tick: r.updated_tick } : undefined;
  }
  count(t: "chunks" | "players"): number { return this.qCount[t].get()!.n; }

  openBatch(): BatchHandle {
    if (this.closed) throw new Error("store closed");
    const id = this.nextId++; const rec = { resolve: () => {}, reject: () => {}, chunks: [], players: [], committed: false } as unknown as Pending;
    const done = new Promise<void>((res, rej) => { rec.resolve = res; rec.reject = rej; });
    done.catch(() => undefined); // surfaced through commit()'s promise
    rec.done = done; this.pending.set(id, rec);
    return {
      append: (part) => {
        if (rec.committed) throw new Error("batch already committed");
        for (const c of part.chunks ?? []) { this.overlayChunks.set(c.key, c); rec.chunks.push(c); }
        for (const p of part.players ?? []) { this.overlayPlayers.set(p.token, p); rec.players.push(p); }
        if (part.meta) this.overlayMeta = { ...part.meta };
        if (this.worker) this.worker.postMessage({ type: "part", id, part });
        else { let l = this.inlineParts.get(id); if (!l) this.inlineParts.set(id, (l = [])); l.push(part); }
      },
      commit: () => {
        if (!rec.committed) {
          rec.committed = true;
          if (this.worker) this.worker.postMessage({ type: "commit", id });
          else setImmediate(() => this.commitInline(id));
        }
        return done;
      },
    };
  }
  write(batch: SaveBatch): Promise<void> { const b = this.openBatch(); b.append(batch); return b.commit(); }

  private inlineTx?: (parts: SaveBatch[]) => { bytes: number; chunks: number; players: number };
  private commitInline(id: number): void {
    const parts = this.inlineParts.get(id) ?? []; this.inlineParts.delete(id);
    if (!this.inlineTx) {
      const pc = this.db.prepare("INSERT INTO chunks(key, cx, cy, format, data, updated_tick) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET cx = excluded.cx, cy = excluded.cy, format = excluded.format, data = excluded.data, updated_tick = excluded.updated_tick");
      const dc = this.db.prepare("DELETE FROM chunks WHERE key = ?");
      const pp = this.db.prepare("INSERT INTO players(token, name, format, data, updated_tick, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET name = excluded.name, format = excluded.format, data = excluded.data, updated_tick = excluded.updated_tick, updated_at = excluded.updated_at");
      const pm = this.db.prepare("INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
      const buf = (u: Uint8Array): Buffer => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
      this.inlineTx = this.db.transaction((ps: SaveBatch[]) => {
        let bytes = 0, chunks = 0, players = 0; const now = Date.now();
        for (const p of ps) {
          for (const k of p.deleteChunks ?? []) dc.run(k);
          for (const c of p.chunks ?? []) { const i = c.key.indexOf(","); pc.run(c.key, Number(c.key.slice(0, i)), Number(c.key.slice(i + 1)), c.format, buf(c.bytes), c.tick); bytes += c.bytes.length; chunks++; }
          for (const pl of p.players ?? []) { pp.run(pl.token, pl.name, pl.format, buf(pl.bytes), pl.tick, now); bytes += pl.bytes.length; players++; }
          if (p.meta) for (const [k, v] of Object.entries(p.meta)) pm.run(k, String(v));
        }
        return { bytes, chunks, players };
      });
    }
    const t0 = performance.now();
    try { const r = this.inlineTx(parts); this.settle(id, undefined, { ...r, ms: performance.now() - t0 }); }
    catch (e) { this.settle(id, e instanceof Error ? e : new Error(String(e))); }
  }

  /** Waits for every batch committed so far (open, uncommitted batches are not waited for). */
  async flush(): Promise<void> { await Promise.allSettled([...this.pending.values()].filter((p) => p.committed).map((p) => p.done)); }
  async close(): Promise<void> {
    if (this.closed) return;
    // Commit any batch that was opened but never committed (shutdown path), then flush.
    for (const [id, p] of [...this.pending]) if (!p.committed) { p.committed = true; if (this.worker) this.worker.postMessage({ type: "commit", id }); else setImmediate(() => this.commitInline(id)); }
    await this.flush(); this.closed = true;
    const w = this.worker;
    if (w) await new Promise<void>((res) => { w.once("exit", () => res()); w.postMessage({ type: "close" }); });
    try { this.db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* best effort */ }
    this.db.close();
  }
  stats(): StoreStats { return { ...this.s, pendingBatches: this.pending.size, pendingChunks: this.overlayChunks.size }; }
}
