# @engine/persist

World and player persistence. Core/world own the chunk format (`encodeChunk`/`decodeChunk`, versioned); this package
owns storage.

- `WorldStore` (async transactional writes, read-your-writes overlay): `SqliteWorldStore` (`@engine/persist/node`,
  better-sqlite3, WAL, commits on a worker thread, sync reads), `MemoryWorldStore`, `IndexedDbWorldStore` (browser-hosted
  listen server: async chunk reads via `readChunkAsync`; meta, players and blobs loaded at `open()`; one readwrite
  transaction per batch, serialized; `prefetchChunks` fills a sync cache; `IndexedDbWorldStore.delete(name)`).
- Tables / object stores: `chunks(key "cx,cy", cx, cy, format, data, updated_tick)`, `players(token, name, format, data,
  updated_tick, updated_at)`, `blobs(key, format, data, updated_tick)`, `meta(k, v)` with `seed`, `tick`, `schemaHash`,
  `nextPlayerId`, and `records(ns, id, format, data, owner_kind, owner_id, chunk, updated_tick)` (PK (ns, id), indexes
  (ns, owner_kind, owner_id) and (ns, chunk)). SQLite `PRAGMA user_version` = store schema version (3; older files gain
  `blobs` / `records` on open). IndexedDB version 2 (object store `records`, keyPath [ns, id]).
- **Generic records** (`SaveBatch.records` / `deleteRecords`, `readRecord(ns, id)`, `listRecords(ns, {ownerKind, ownerId,
  chunk})`): row-per-object world data owned by a gameplay system, opaque versioned bytes plus indexed owner
  (`OwnerKind` None/Player=PlayerId/Group=party-or-clan id, like core `OwnedBy`) and anchoring chunk. Atomic with the rest
  of a batch, read-your-writes, resident on IndexedDB. Planned use - trade stalls (not built yet): ns `stall` (one row
  per stall, chunk = location, owner = player or clan), `listing` (one row per listed item; the item's slot bytes carry
  `crafterId` like any inventory slot, so persist needs no change when items gain it), `earnings` (one row per owner).
  A sale = one batch: delete the listing, upsert the earnings row. Stall entities in the world can keep using
  persistent components (OwnedBy/AccessList) through the chunk codec; records hold what must outlive chunk unloads or
  be queried by owner while the chunk is not loaded.
- `WorldPersistence`: give `provider` to `ChunkManager`, then `attach(chunks)`.
  - Load: stored row → `decodeChunk` (entities + buildings), else the generator. Untouched generated chunks are never
    written, so the file grows with what players changed, not with world size.
  - Async stores: `provider` is core's `AsyncChunkProvider`. Rows in the pending overlay/cache and keys the store
    knows are absent (`hasChunk`) answer synchronously; otherwise one Promise per key (concurrent and re-requested loads
    share it). When a read lands after ChunkManager dropped the request (`!chunks.isPending(key)`), the row is NOT
    decoded (decoding spawns entities), so late results leave nothing behind.
- Social state (`social.ts`): `loadSocial(store)` → `{groups, claims}` for `installPermissions(world, social)` and
  `WorldPersistence({ social })`. Blob `groups` = core `GroupRegistry.encode()` (format v2 with banners; v1 decodes);
  blob `claims` = persist's claims format v1 (`encodeClaims`/`decodeClaims`: nextId, defaultFlags, every claim field;
  core has no ClaimRegistry codec). Written with the autosave round / `saveAll` only when changed (GroupRegistry `seq`,
  claim bytes). A record that fails to decode throws at startup instead of starting empty and overwriting it.
  Per-entity privileges (`OwnedBy`, `AccessList`) and identity (`PlayerId`, `Membership`) are persistent components:
  they travel in the chunk codec / player record. `allocatePlayerId()` hands out account ids (counter written first).
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
Benchmarks: `pnpm bench` (500 dirty chunks + one 3000-piece base; numbers in the bench output, last run in the commit log).
