// @ts-check
/**
 * SQLite writer thread for SqliteWorldStore. Owns the only write connection; the main thread keeps a read
 * connection (WAL lets readers and this writer run concurrently). Messages:
 *   main -> worker: {type:"part", id, part} ... {type:"commit", id} | {type:"close"}
 *   worker -> main: {type:"ready"} | {type:"done", id, ms, bytes, chunks, players} | {type:"error", id, message}
 * Each batch id is committed in ONE transaction, so a crash leaves either the whole autosave round or none of it.
 */
import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";

const db = new Database(workerData.path);
db.pragma("journal_mode = WAL");
db.pragma(`synchronous = ${workerData.synchronous ?? "NORMAL"}`);
db.pragma("busy_timeout = 5000");
const putChunk = db.prepare("INSERT INTO chunks(key, cx, cy, format, data, updated_tick) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET cx = excluded.cx, cy = excluded.cy, format = excluded.format, data = excluded.data, updated_tick = excluded.updated_tick");
const delChunk = db.prepare("DELETE FROM chunks WHERE key = ?");
const putPlayer = db.prepare("INSERT INTO players(token, name, format, data, updated_tick, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET name = excluded.name, format = excluded.format, data = excluded.data, updated_tick = excluded.updated_tick, updated_at = excluded.updated_at");
const putMeta = db.prepare("INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
const putBlob = db.prepare("INSERT INTO blobs(key, format, data, updated_tick) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET format = excluded.format, data = excluded.data, updated_tick = excluded.updated_tick");

/** @param {Uint8Array} u */
const buf = (u) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
/** @param {string} k */
const coords = (k) => { const i = k.indexOf(","); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };

const apply = db.transaction((/** @type {any[]} */ parts) => {
  let bytes = 0, chunks = 0, players = 0; const now = Date.now();
  for (const p of parts) {
    for (const k of p.deleteChunks ?? []) delChunk.run(k);
    for (const c of p.chunks ?? []) { const [cx, cy] = coords(c.key); putChunk.run(c.key, cx, cy, c.format, buf(c.bytes), c.tick); bytes += c.bytes.byteLength; chunks++; }
    for (const pl of p.players ?? []) { putPlayer.run(pl.token, pl.name, pl.format, buf(pl.bytes), pl.tick, now); bytes += pl.bytes.byteLength; players++; }
    for (const b of p.blobs ?? []) { putBlob.run(b.key, b.format, buf(b.bytes), b.tick); bytes += b.bytes.byteLength; }
    if (p.meta) for (const [k, v] of Object.entries(p.meta)) if (v !== undefined) putMeta.run(k, String(v));
  }
  return { bytes, chunks, players };
});

/** @type {Map<number, any[]>} */
const open = new Map();
const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
port.on("message", (/** @type {any} */ m) => {
  if (m.type === "part") { let l = open.get(m.id); if (!l) open.set(m.id, (l = [])); l.push(m.part); return; }
  if (m.type === "commit") {
    const parts = open.get(m.id) ?? []; open.delete(m.id); const t0 = performance.now();
    try { const r = apply(parts); port.postMessage({ type: "done", id: m.id, ms: performance.now() - t0, ...r }); }
    catch (e) { port.postMessage({ type: "error", id: m.id, message: String(e instanceof Error ? e.message : e) }); }
    return;
  }
  if (m.type === "close") { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* readers may hold it */ } db.close(); port.postMessage({ type: "closed" }); port.close(); }
});
port.postMessage({ type: "ready" });
