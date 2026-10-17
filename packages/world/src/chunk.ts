export const CHUNK_SIZE = 32;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
/** Tile ids are u16 numeric ids into a tile registry (0 = empty). */
export class Chunk {
  readonly tiles = new Uint16Array(CHUNK_AREA);
  readonly height = new Uint8Array(CHUNK_AREA);
  dirty = false; version = 0;
  constructor(readonly cx: number, readonly cy: number) {}
  get(lx: number, ly: number): number { return this.tiles[ly * CHUNK_SIZE + lx]!; }
  set(lx: number, ly: number, id: number): void {
    const i = ly * CHUNK_SIZE + lx; if (this.tiles[i] === id) return;
    this.tiles[i] = id; this.dirty = true; this.version++;
  }
}
export const chunkKey = (cx: number, cy: number): number => ((cx & 0xffff) << 16 | (cy & 0xffff)) >>> 0;
export const tileToChunk = (t: number): number => Math.floor(t / CHUNK_SIZE);
export const tileToLocal = (t: number): number => ((t % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

export class TileMap {
  private chunks = new Map<number, Chunk>();
  getChunk(cx: number, cy: number): Chunk | undefined { return this.chunks.get(chunkKey(cx, cy)); }
  ensureChunk(cx: number, cy: number): Chunk {
    const k = chunkKey(cx, cy); let c = this.chunks.get(k);
    if (!c) { c = new Chunk(cx, cy); this.chunks.set(k, c); } return c;
  }
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
