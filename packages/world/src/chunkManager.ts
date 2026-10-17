import { Chunk, chunkKey, parseChunkKey, TileMap, tileToChunk, tileToLocal, type ChunkKey } from "./chunk.js";
import type { ChunkProvider, NodePlacement } from "./generator.js";

export interface InterestSource { id: number; x: number; y: number; /** load radius in chunks (default manager radius) */ radius?: number }
export interface ChunkManagerOptions {
  provider: ChunkProvider;
  /** Chunks within this Chebyshev radius of any source are kept active. */
  loadRadius?: number;
  /** Extra radius before an active chunk is released (hysteresis). */
  unloadMargin?: number;
  /** Max inactive chunks kept in the LRU cache before being evicted (onUnload fires on eviction). */
  cacheSize?: number;
  /** Max chunk loads per update() (streaming budget). */
  maxLoadsPerUpdate?: number;
}
export type ChunkLoadHook = (chunk: Chunk, nodes: readonly NodePlacement[]) => void;
export type ChunkUnloadHook = (chunk: Chunk) => void;

/**
 * Streaming chunk manager. Active set = union of squares around interest sources. Chunks leaving the active set go
 * to an LRU cache; evicted chunks fire onUnload (persist there) and are dropped. Loads come from the provider.
 * Hook names `onLoad` / `onUnload` are stable (Netcode codes against them).
 */
export class ChunkManager extends TileMap {
  readonly loadRadius: number; readonly unloadMargin: number; readonly cacheSize: number; readonly maxLoads: number;
  private sources = new Map<number, InterestSource>();
  private active = new Set<ChunkKey>();
  /** LRU of inactive-but-resident chunk keys (Map iteration order = recency). */
  private lru = new Map<ChunkKey, true>();
  private loadHooks: ChunkLoadHook[] = []; private unloadHooks: ChunkUnloadHook[] = [];
  private pending: ChunkKey[] = [];
  stats = { loads: 0, unloads: 0, cacheHits: 0 };
  constructor(private opts: ChunkManagerOptions) {
    super();
    this.loadRadius = opts.loadRadius ?? 2; this.unloadMargin = opts.unloadMargin ?? 1;
    this.cacheSize = opts.cacheSize ?? 64; this.maxLoads = opts.maxLoadsPerUpdate ?? Infinity;
  }
  onLoad(fn: ChunkLoadHook): () => void { this.loadHooks.push(fn); return () => rm(this.loadHooks, fn); }
  onUnload(fn: ChunkUnloadHook): () => void { this.unloadHooks.push(fn); return () => rm(this.unloadHooks, fn); }
  setSource(s: InterestSource): void { this.sources.set(s.id, { ...s }); }
  removeSource(id: number): void { this.sources.delete(id); }
  isActive(k: ChunkKey): boolean { return this.active.has(k); }
  get activeKeys(): ReadonlySet<ChunkKey> { return this.active; }
  get pendingLoads(): number { return this.pending.length; }

  /** Recompute active set, queue/perform loads (budgeted), move released chunks to LRU, evict overflow. */
  update(): void {
    const want = new Set<ChunkKey>(), keep = new Set<ChunkKey>();
    for (const s of this.sources.values()) {
      const r = s.radius ?? this.loadRadius, cx = tileToChunk(s.x), cy = tileToChunk(s.y), R = r + this.unloadMargin;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const k = chunkKey(cx + dx, cy + dy); keep.add(k);
        if (Math.abs(dx) <= r && Math.abs(dy) <= r) want.add(k);
      }
    }
    for (const k of [...this.active]) if (!keep.has(k)) { this.active.delete(k); this.lru.delete(k); this.lru.set(k, true); }
    const queued = new Set(this.pending);
    for (const k of want) if (!this.active.has(k)) {
      if (this.chunks.has(k)) { this.active.add(k); this.lru.delete(k); this.stats.cacheHits++; }
      else if (!queued.has(k)) { this.pending.push(k); queued.add(k); }
    }
    let n = 0;
    while (this.pending.length && n < this.maxLoads) {
      const k = this.pending.shift()!; if (!want.has(k) || this.chunks.has(k)) continue;
      const { cx, cy } = parseChunkKey(k); const g = this.opts.provider.load(cx, cy);
      const chunk = g?.chunk ?? new Chunk(cx, cy);
      this.chunks.set(k, chunk); this.active.add(k); this.stats.loads++; n++;
      for (const h of this.loadHooks) h(chunk, g?.nodes ?? []);
    }
    while (this.lru.size > this.cacheSize) this.evict(this.lru.keys().next().value!);
  }
  /** Force-unload a chunk (fires onUnload). */
  evict(k: ChunkKey): void {
    const c = this.chunks.get(k); this.lru.delete(k); this.active.delete(k); if (!c) return;
    for (const h of this.unloadHooks) h(c);
    this.chunks.delete(k); this.stats.unloads++;
  }
  /** Writes to unloaded chunks are ignored (returns false) — the world only mutates resident chunks. */
  trySetTile(tx: number, ty: number, id: number): boolean {
    const c = this.getChunk(tileToChunk(tx), tileToChunk(ty)); if (!c) return false;
    c.set(tileToLocal(tx), tileToLocal(ty), id); return true;
  }
}
function rm<T>(a: T[], v: T): void { const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); }
