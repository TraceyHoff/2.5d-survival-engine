/**
 * Chunked tile storage. Chunk coordinates are signed 32-bit integers (effectively unbounded).
 * ChunkKey is a string "cx,cy" — stable, unbounded and cheap enough for per-tick interest work.
 */
export const CHUNK_SIZE = 32;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export type ChunkKey = string;

/** Tile ids are u16 numeric ids into a tile registry (0 = empty). */
export class Chunk {
  readonly tiles = new Uint16Array(CHUNK_AREA);
  readonly height = new Uint8Array(CHUNK_AREA);
  /** Set when tiles change; cleared by whoever persists/streams the chunk. */
  dirty = false; version = 0;
  readonly key: ChunkKey;
  constructor(readonly cx: number, readonly cy: number) { this.key = chunkKey(cx, cy); }
  get(lx: number, ly: number): number { return this.tiles[ly * CHUNK_SIZE + lx]!; }
  set(lx: number, ly: number, id: number): void {
    const i = ly * CHUNK_SIZE + lx; if (this.tiles[i] === id) return;
    this.tiles[i] = id; this.dirty = true; this.version++;
  }
  getHeight(lx: number, ly: number): number { return this.height[ly * CHUNK_SIZE + lx]!; }
  setHeight(lx: number, ly: number, h: number): void { this.height[ly * CHUNK_SIZE + lx] = h; this.dirty = true; this.version++; }
}
const I32 = (n: number): number => n | 0;
export const chunkKey = (cx: number, cy: number): ChunkKey => `${I32(cx)},${I32(cy)}`;
export function parseChunkKey(k: ChunkKey): { cx: number; cy: number } {
  const i = k.indexOf(","); return { cx: Number(k.slice(0, i)), cy: Number(k.slice(i + 1)) };
}
export const tileToChunk = (t: number): number => Math.floor(t / CHUNK_SIZE);
export const tileToLocal = (t: number): number => ((Math.floor(t) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
/** Chunk coords containing a world position (float tile units). */
export const chunkOf = (pos: { x: number; y: number }): { cx: number; cy: number } => ({ cx: Math.floor(pos.x / CHUNK_SIZE), cy: Math.floor(pos.y / CHUNK_SIZE) });
export const chunkKeyOf = (x: number, y: number): ChunkKey => chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));

/** Plain chunk container (no streaming). ChunkManager builds on it. */
export class TileMap {
  protected chunks = new Map<ChunkKey, Chunk>();
  getChunk(cx: number, cy: number): Chunk | undefined { return this.chunks.get(chunkKey(cx, cy)); }
  getChunkByKey(k: ChunkKey): Chunk | undefined { return this.chunks.get(k); }
  ensureChunk(cx: number, cy: number): Chunk {
    const k = chunkKey(cx, cy); let c = this.chunks.get(k);
    if (!c) { c = new Chunk(cx, cy); this.chunks.set(k, c); } return c;
  }
  insertChunk(c: Chunk): void { this.chunks.set(c.key, c); }
  unloadChunk(cx: number, cy: number): boolean { return this.chunks.delete(chunkKey(cx, cy)); }
  getTile(tx: number, ty: number): number {
    return this.getChunk(tileToChunk(tx), tileToChunk(ty))?.get(tileToLocal(tx), tileToLocal(ty)) ?? 0;
  }
  setTile(tx: number, ty: number, id: number): void {
    this.ensureChunk(tileToChunk(tx), tileToChunk(ty)).set(tileToLocal(tx), tileToLocal(ty), id);
  }
  get chunkCount(): number { return this.chunks.size; }
  *loadedChunks(): IterableIterator<Chunk> { yield* this.chunks.values(); }
}

/**
 * Float precision guidance (see ARCHITECTURE "World Streaming"): Transform is f32 tile units.
 * f32 keeps <= 1/256-tile precision up to |x| < 65,536 tiles (2,048 chunks) and integer precision to 2^24.
 * Beyond that, simulate relative to a WorldOrigin (rebased per server region / client camera) and
 * persist chunk-local positions (the chunk codec stores positions relative to the chunk origin).
 */
export const F32_SAFE_TILE_RANGE = 65536;
export class WorldOrigin {
  constructor(public ox = 0, public oy = 0) {}
  toLocal(x: number, y: number): { x: number; y: number } { return { x: x - this.ox, y: y - this.oy }; }
  toWorld(x: number, y: number): { x: number; y: number } { return { x: x + this.ox, y: y + this.oy }; }
  /** Rebase origin to a chunk corner near (x,y) when |local| exceeds `threshold`. Returns shift applied (to subtract from positions). */
  maybeRebase(x: number, y: number, threshold = F32_SAFE_TILE_RANGE / 2): { dx: number; dy: number } {
    const l = this.toLocal(x, y);
    if (Math.abs(l.x) < threshold && Math.abs(l.y) < threshold) return { dx: 0, dy: 0 };
    const nx = Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE, ny = Math.floor(y / CHUNK_SIZE) * CHUNK_SIZE;
    const d = { dx: nx - this.ox, dy: ny - this.oy }; this.ox = nx; this.oy = ny; return d;
  }
}
