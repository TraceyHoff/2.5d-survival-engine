import { entityIndex, Owner, Transform, type ComponentStore, type Entity, type World } from "@engine/core";
import { ChunkMembership, decodeChunk, encodeChunk, parseChunkKey, chunkKeyOf, type BuildingGrid, type ChunkKey, type ChunkManager, type ChunkProvider, type GeneratedChunk } from "@engine/world";
import { decodePlayerInto, encodePlayer, PLAYER_VERSION, type PlayerCodecOptions, type PlayerRestoreResult } from "./playerCodec.js";
import { chunkFormatOf, type BatchHandle, type SaveBatch, type StoredChunk, type WorldMeta, type WorldStore } from "./types.js";

export interface WorldPersistenceOptions {
  world: World;
  store: WorldStore;
  /** Fallback when the store has no row for a chunk (and the source of resource-node placements). */
  generator: ChunkProvider;
  buildings?: BuildingGrid;
  tickHz?: number;
  /** Autosave period for dirty chunks (default 30 s). 0 disables. */
  autosaveSeconds?: number;
  /** Periodic save of online players (default 60 s). 0 disables. */
  playerSaveSeconds?: number;
  /** Max wall-clock ms per tick spent encoding an autosave round (default 1.5). At least one chunk per tick. */
  encodeBudgetMs?: number;
  /**
   * Entities saved with their chunk. Default: has a `persistent` component other than Transform and is not owned by
   * a client (players are saved separately, keyed by account token).
   */
  persistEntity?: (world: World, e: Entity) => boolean;
  /** Entities destroyed when their chunk unloads. Default: every non-player entity with Transform in the chunk. */
  despawnOnUnload?: (world: World, e: Entity) => boolean;
  /**
   * When a chunk comes from storage, still hand the generator's resource-node placements to onLoad (default true).
   * Needed while gameplay's ResourceNode is not a persistent component; nodes then respawn full after reload.
   */
  regenerateNodes?: boolean;
  player?: PlayerCodecOptions;
  /** Injected wall clock for the encode budget / stats (persist is infrastructure, not sim). */
  now?: () => number;
  log?: (msg: string) => void;
  onDecodeError?: (key: ChunkKey, err: unknown) => void;
}

export interface PersistenceStats {
  dirtyChunks: number;
  roundsCompleted: number;
  /** Chunks encoded in the last completed round. */
  lastRoundChunks: number;
  /** Ticks the last round spanned. */
  lastRoundTicks: number;
  /** Total encode ms of the last round (spread over lastRoundTicks). */
  lastRoundEncodeMs: number;
  /** Persistence ms in the most recent tick / worst tick since reset (tracking + encoding + posting). */
  lastTickMs: number;
  maxTickMs: number;
  chunksLoadedFromStore: number;
  chunksGenerated: number;
  chunksSavedOnUnload: number;
  playersSaved: number;
  decodeErrors: number;
}

interface Round { batch: BatchHandle; queue: ChunkKey[]; encoded: Set<ChunkKey>; requeued: Set<ChunkKey>; startTick: number; encodeMs: number; count: number; flushPlayers: boolean }

const isPlayer = (w: World, e: Entity): boolean => w.has(e, Owner) && w.getField(e, Owner, "clientId") !== 0;

/**
 * Chunk + player persistence on top of a WorldStore.
 *
 * - `provider` (give it to ChunkManager): store row -> decodeChunk, else generator. Untouched generated chunks are
 *   never written, so storage grows with what players changed, not with world size.
 * - Dirty tracking (O(changes) per tick, postSim system `persist.track`): chunk tile version, building place/remove,
 *   and persistent-entity add/change/move/remove via a ChunkMembership.
 * - Autosave (`persist.autosave`): every N s, dirty resident chunks are encoded ON the tick within a wall-clock
 *   budget (default 1.5 ms/tick), parts are posted to the store as they are encoded, and the whole round commits as
 *   ONE transaction off-thread. A chunk dirtied again after it was encoded in the running round is re-encoded once.
 * - onUnload: encode (if dirty) into the running round or its own batch, then despawn the chunk's entities and drop
 *   its buildings. Players: `trackPlayer/untrackPlayer`, `savePlayer`, `restorePlayer`, periodic save.
 * - `saveAll()` for graceful shutdown.
 */
export class WorldPersistence {
  readonly world: World;
  readonly store: WorldStore;
  readonly membership: ChunkMembership;
  readonly provider: ChunkProvider;
  readonly stats: PersistenceStats = {
    dirtyChunks: 0, roundsCompleted: 0, lastRoundChunks: 0, lastRoundTicks: 0, lastRoundEncodeMs: 0, lastTickMs: 0, maxTickMs: 0,
    chunksLoadedFromStore: 0, chunksGenerated: 0, chunksSavedOnUnload: 0, playersSaved: 0, decodeErrors: 0,
  };
  private chunks: ChunkManager | undefined;
  private dirty = new Set<ChunkKey>();
  private savedVersion = new Map<ChunkKey, number>();
  /** Chunks whose stored row could not be decoded: never overwritten this session (keeps the data for a migration). */
  private readOnly = new Set<ChunkKey>();
  private persisted = new Set<Entity>();
  private fresh = new Set<Entity>();
  private round: Round | undefined;
  private online = new Map<string, { entity: Entity; name: string }>();
  private quiet = false;
  private tickMs = 0;
  /** EWMA of encode ms per cost unit (1 + pieces/200), for the per-tick budget. */
  private msPerUnit = 0.2;
  private readonly autosaveTicks: number; private readonly playerTicks: number; private readonly budget: number;
  private readonly persistEntity: (w: World, e: Entity) => boolean;
  private readonly despawn: (w: World, e: Entity) => boolean;
  private readonly now: () => number;
  private persistentStores: ComponentStore[];
  private nextAutosave: number; private nextPlayerSave: number;

  constructor(private readonly opts: WorldPersistenceOptions) {
    this.world = opts.world; this.store = opts.store;
    const hz = opts.tickHz ?? 20;
    this.autosaveTicks = Math.round((opts.autosaveSeconds ?? 30) * hz);
    this.playerTicks = Math.round((opts.playerSaveSeconds ?? 60) * hz);
    this.budget = opts.encodeBudgetMs ?? 1.5;
    this.now = opts.now ?? (() => performance.now());
    this.persistentStores = this.world.componentStores.filter((s) => s.def.persistent);
    const extra = this.persistentStores.filter((s) => s.def !== (Transform as unknown));
    this.persistEntity = opts.persistEntity ?? ((w, e) => { const i = entityIndex(e); return w.isAlive(e) && !isPlayer(w, e) && extra.some((s) => s.has(i)); });
    this.despawn = opts.despawnOnUnload ?? ((w, e) => !isPlayer(w, e));
    this.nextAutosave = this.world.tick + this.autosaveTicks; this.nextPlayerSave = this.world.tick + this.playerTicks;
    this.membership = new ChunkMembership(this.world);
    this.membership.onMove = (e, from, to) => {
      if (this.quiet || this.fresh.has(e)) return;
      if (this.persisted.has(e) || this.persistEntity(this.world, e)) {
        if (from !== undefined) this.markDirty(from);
        if (to !== undefined) { this.markDirty(to); this.persisted.add(e); } else this.persisted.delete(e);
      }
    };
    this.provider = { load: (cx, cy) => this.load(cx, cy) };
    if (opts.buildings) {
      const b = opts.buildings; const prevPlace = b.onPlace, prevRemove = b.onRemove;
      b.onPlace = (i) => { prevPlace?.(i); if (!this.quiet) this.markDirty(chunkKeyOf(i.tx, i.ty)); };
      b.onRemove = (i) => { prevRemove?.(i); if (!this.quiet) this.markDirty(chunkKeyOf(i.tx, i.ty)); };
    }
  }

  /** Wire into a ChunkManager built with `provider`. Registers postSim systems persist.track + persist.autosave. */
  attach(chunks: ChunkManager): this {
    this.chunks = chunks;
    chunks.onUnload((c) => this.onUnload(c.key));
    this.membership.rebuild();
    const w = this.world;
    w.addSystem("postSim", "persist.track", () => { const t0 = this.now(); this.track(); this.tickMs = this.now() - t0; });
    w.addSystem("postSim", "persist.autosave", () => {
      const t0 = this.now(); this.autosaveStep();
      this.stats.lastTickMs = this.tickMs + (this.now() - t0); this.stats.maxTickMs = Math.max(this.stats.maxTickMs, this.stats.lastTickMs);
    });
    if (!this.store.readMeta()) void this.store.write({ meta: this.meta() });
    return this;
  }

  meta(): WorldMeta { return { seed: this.world.seed, tick: this.world.tick, schemaHash: this.world.getSchemaHash() }; }
  /** Mark a chunk for the next autosave (e.g. gameplay changed building hp, which has no hook yet). */
  markDirty(key: ChunkKey): void {
    if (this.readOnly.has(key)) return;
    const r = this.round;
    if (r && r.encoded.has(key) && !r.requeued.has(key)) { r.encoded.delete(key); r.requeued.add(key); r.queue.push(key); return; }
    this.dirty.add(key);
  }
  isDirty(key: ChunkKey): boolean { return this.dirty.has(key) || this.versionChanged(key); }
  get roundInProgress(): boolean { return this.round !== undefined; }
  resetMaxTick(): void { this.stats.maxTickMs = 0; }

  // ---------------- chunks ----------------
  private load(cx: number, cy: number): GeneratedChunk | undefined {
    const gen = this.opts.generator; const rec = this.store.readChunk(`${cx},${cy}`);
    if (rec) {
      this.quiet = true;
      try {
        const d = decodeChunk(rec.bytes, { world: this.world, ...(this.opts.buildings ? { buildings: this.opts.buildings } : {}) });
        for (const e of d.entities) { this.fresh.add(e); this.persisted.add(e); }
        this.savedVersion.set(d.chunk.key, d.chunk.version); this.stats.chunksLoadedFromStore++;
        const nodes = this.opts.regenerateNodes === false ? [] : gen.load(cx, cy)?.nodes ?? [];
        return { chunk: d.chunk, nodes };
      } catch (err) {
        this.stats.decodeErrors++; this.readOnly.add(rec.key);
        this.opts.onDecodeError?.(rec.key, err); this.opts.log?.(`persist: chunk ${rec.key} failed to decode (${String(err)}); using generator, row kept read-only`);
      } finally { this.quiet = false; }
    }
    const g = gen.load(cx, cy); if (g) { this.savedVersion.set(g.chunk.key, g.chunk.version); this.stats.chunksGenerated++; }
    return g;
  }
  private versionChanged(key: ChunkKey): boolean {
    const c = this.chunks?.getChunkByKey(key); return !!c && this.savedVersion.get(key) !== c.version;
  }
  /** Encode one resident chunk (tiles, buildings anchored in it, persistent entities in it). */
  encode(key: ChunkKey): StoredChunk | undefined {
    const c = this.chunks?.getChunkByKey(key); if (!c || this.readOnly.has(key)) return undefined;
    const ents: Entity[] = []; for (const e of this.membership.entitiesIn(key)) if (this.persistEntity(this.world, e)) ents.push(e);
    const bytes = encodeChunk(c, { world: this.world, entities: ents, ...(this.opts.buildings ? { buildings: this.opts.buildings } : {}) });
    this.savedVersion.set(key, c.version); c.dirty = false;
    return { key, format: chunkFormatOf(bytes), bytes, tick: this.world.tick };
  }
  private onUnload(key: ChunkKey): void {
    const r = this.round;
    const needs = this.dirty.has(key) || this.versionChanged(key) || (r !== undefined && r.queue.includes(key) && !r.encoded.has(key));
    if (needs) {
      const rec = this.encode(key);
      if (rec) { if (r) { r.batch.append({ chunks: [rec] }); r.encoded.add(key); r.count++; } else void this.store.write({ chunks: [rec] }).catch((e) => this.opts.log?.(`persist: unload save failed: ${String(e)}`)); this.stats.chunksSavedOnUnload++; }
    }
    this.dirty.delete(key);
    if (r) { r.encoded.add(key); } // already saved (or clean): skip if still queued
    this.quiet = true;
    try {
      for (const e of [...this.membership.entitiesIn(key)]) if (this.despawn(this.world, e)) { this.persisted.delete(e); this.membership.set(e, undefined); this.world.destroy(e); }
      this.opts.buildings?.unloadChunk(key);
    } finally { this.quiet = false; }
    this.savedVersion.delete(key); this.readOnly.delete(key);
  }

  // ---------------- per-tick ----------------
  private track(): void {
    const w = this.world;
    this.membership.update(); // fires onMove for chunk changes, spawns and removals
    for (const s of this.persistentStores) {
      for (const i of s.changedIndices()) {
        const e = s.dense[s.slot(i)]! as Entity; if (this.fresh.has(e)) continue;
        if (!this.persistEntity(w, e)) {
          if (this.persisted.delete(e)) { const k = this.membership.chunkOf(e); if (k !== undefined) this.markDirty(k); } // stopped being persistent
          continue;
        }
        this.persisted.add(e); const k = this.membership.chunkOf(e); if (k !== undefined) this.markDirty(k);
      }
    }
    this.fresh.clear();
    this.stats.dirtyChunks = this.dirty.size;
  }

  private autosaveStep(): void {
    const t = this.world.tick;
    if (this.playerTicks > 0 && t >= this.nextPlayerSave) { this.nextPlayerSave = t + this.playerTicks; if (this.online.size) void this.savePlayers().catch((e) => this.opts.log?.(`persist: player save failed: ${String(e)}`)); }
    if (!this.round && this.autosaveTicks > 0 && t >= this.nextAutosave) { this.nextAutosave = t + this.autosaveTicks; this.beginRound(); }
    if (this.round) this.continueRound(this.budget);
  }

  /** Starts an autosave round (no-op if one is running). Returns false if there was nothing to save. */
  beginRound(): boolean {
    if (this.round || !this.chunks) return false;
    const queue: ChunkKey[] = [];
    for (const c of this.chunks.loadedChunks()) if (this.dirty.has(c.key) || this.savedVersion.get(c.key) !== c.version) queue.push(c.key);
    this.dirty.clear(); this.stats.dirtyChunks = 0;
    if (!queue.length) return false;
    this.round = { batch: this.store.openBatch(), queue, encoded: new Set(), requeued: new Set(), startTick: this.world.tick, encodeMs: 0, count: 0, flushPlayers: false };
    return true;
  }
  /** Encodes queued chunks until `budgetMs` is used (always at least one), posts them, commits when the queue is empty. */
  continueRound(budgetMs: number): Promise<void> | undefined {
    const r = this.round; if (!r) return undefined;
    const t0 = this.now(); const part: StoredChunk[] = [];
    let n = 0;
    while (r.queue.length) {
      const k = r.queue[0]!; if (r.encoded.has(k)) { r.queue.shift(); continue; }
      // Predict this chunk's cost (building-heavy chunks cost more) and leave it for the next tick if it would
      // overrun the budget. At least one chunk per tick so a round always progresses.
      const units = 1 + (this.opts.buildings?.layer(k)?.anchored.size ?? 0) / 200;
      const elapsed = this.now() - t0;
      if (n > 0 && elapsed + this.msPerUnit * units > budgetMs) break;
      r.queue.shift();
      const c0 = this.now(); const rec = this.encode(k); const ms = this.now() - c0;
      this.msPerUnit = this.msPerUnit * 0.8 + (ms / units) * 0.2;
      r.encoded.add(k); n++; if (rec) { part.push(rec); r.count++; }
    }
    r.encodeMs += this.now() - t0;
    const batch: SaveBatch = { chunks: part };
    if (!r.queue.length) batch.meta = this.meta();
    if (part.length || batch.meta) r.batch.append(batch);
    if (r.queue.length) return undefined;
    this.round = undefined;
    this.stats.roundsCompleted++; this.stats.lastRoundChunks = r.count; this.stats.lastRoundTicks = this.world.tick - r.startTick + 1; this.stats.lastRoundEncodeMs = r.encodeMs;
    const p = r.batch.commit(); p.catch((e) => this.opts.log?.(`persist: autosave commit failed: ${String(e)}`));
    return p;
  }

  // ---------------- players ----------------
  trackPlayer(token: string, entity: Entity, name = ""): void { this.online.set(token, { entity, name }); }
  untrackPlayer(token: string): void { this.online.delete(token); }
  isOnline(token: string): boolean { return this.online.has(token); }
  get onlinePlayers(): ReadonlyMap<string, { entity: Entity; name: string }> { return this.online; }
  hasPlayer(token: string): boolean { return this.store.readPlayer(token) !== undefined; }
  /** Restores a saved player onto `entity`; undefined if the token has no save. */
  restorePlayer(token: string, entity: Entity): (PlayerRestoreResult & { name: string }) | undefined {
    const rec = this.store.readPlayer(token); if (!rec) return undefined;
    return { ...decodePlayerInto(this.world, entity, rec.bytes, this.opts.player), name: rec.name };
  }
  /** Encode + queue a player save (its own transaction). */
  savePlayer(token: string, entity: Entity, name?: string): Promise<void> {
    if (!this.world.isAlive(entity)) return Promise.resolve();
    const bytes = encodePlayer(this.world, entity, this.opts.player); this.stats.playersSaved++;
    return this.store.write({ players: [{ token, name: name ?? this.online.get(token)?.name ?? "", format: PLAYER_VERSION, bytes, tick: this.world.tick }] });
  }
  /** Saves every tracked online player in one transaction. */
  savePlayers(): Promise<void> {
    const players = [...this.online].filter(([, p]) => this.world.isAlive(p.entity))
      .map(([token, p]) => ({ token, name: p.name, format: PLAYER_VERSION, bytes: encodePlayer(this.world, p.entity, this.opts.player), tick: this.world.tick }));
    this.stats.playersSaved += players.length;
    return players.length ? this.store.write({ players }) : Promise.resolve();
  }

  /**
   * Full save (graceful shutdown): finishes the running round, encodes every dirty resident chunk and every online
   * player synchronously, commits, and waits until the store has flushed.
   */
  async saveAll(): Promise<{ chunks: number; players: number }> {
    if (!this.round) this.beginRound();
    let chunks = 0;
    if (this.round) { chunks = this.round.queue.length; await this.continueRound(Infinity); }
    const players = this.online.size; await this.savePlayers();
    await this.store.write({ meta: this.meta() });
    await this.store.flush();
    return { chunks, players };
  }
  /** Parsed coordinates of a key (re-export convenience). */
  static coords(k: ChunkKey): { cx: number; cy: number } { return parseChunkKey(k); }
}
