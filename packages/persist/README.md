# @engine/persist

World and player persistence. Core/world own the chunk format (`encodeChunk`/`decodeChunk`, versioned); this package
owns storage.

- `WorldStore` (sync reads, async transactional writes, read-your-writes overlay): `SqliteWorldStore`
  (`@engine/persist/node`, better-sqlite3, WAL, commits on a worker thread), `MemoryWorldStore`, `IndexedDbWorldStore`
  (stub with the planned design for a browser-hosted listen server).
- Tables: `chunks(key "cx,cy", cx, cy, format, data, updated_tick)`, `players(token, name, format, data, updated_tick,
  updated_at)`, `meta(k, v)` with `seed`, `tick`, `schemaHash`. `PRAGMA user_version` = store schema version.
- `WorldPersistence`: give `provider` to `ChunkManager`, then `attach(chunks)`.
  - Load: stored row → `decodeChunk` (entities + buildings), else the generator. Untouched generated chunks are never
    written, so the file grows with what players changed, not with world size.
  - Dirty tracking, O(changes) per tick (`persist.track`, postSim): tile `Chunk.version`, building place/remove
    (BuildingGrid hooks), persistent entities added/changed/moved/removed (own `ChunkMembership`).
  - Autosave (`persist.autosave`): every `autosaveSeconds`, dirty resident chunks are encoded on the tick within
    `encodeBudgetMs` (default 1.5 ms, predicted per chunk from its building count), each tick's part is posted to the
    store, and the whole round commits as one transaction. A chunk dirtied after it was encoded in the running round is
    re-encoded in the same round (an entity moving between chunks is never saved twice or lost).
  - Unload: encode if dirty (into the running round, so ordering holds), then despawn the chunk's non-player entities
    and drop its buildings.
  - Players: `trackPlayer/untrackPlayer`, `savePlayer`, periodic `savePlayers`, `restorePlayer`. Player record v1 keys
    components by name with schema hash and length, so renamed/changed components are skipped, not fatal.
  - `saveAll()` for SIGINT/SIGTERM.
  - A stored chunk that fails to decode (schema change) falls back to the generator and is kept read-only for the
    session, so the saved bytes are not overwritten before a migration exists.
- Session protocol (`session.ts`): `ClaimAccount` / `SetName` commands and the `AccountAssigned` event. Net session
  tokens do not survive a server restart, so the persistent identity is an app-level account token.

Entities saved with a chunk (default): a `persistent` component other than Transform, and not owned by a client.
Benchmarks: `pnpm bench` (500 dirty chunks + one 3000-piece base: about 1.6 ms p95 per tick, 1.7–2.2 ms max, commit on the worker).
