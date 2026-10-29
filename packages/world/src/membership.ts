import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { CHUNK_SIZE, chunkKeyOf, type ChunkKey } from "./chunk.js";

/** Per-chunk entity membership from Transform, maintained incrementally from change/removal records. */
export class ChunkMembership {
  private byChunk = new Map<ChunkKey, Set<Entity>>();
  private chunkOfEntity = new Map<Entity, ChunkKey>();
  /** Fired when an entity's chunk changes (from undefined on first sight, to undefined on removal). */
  onMove?: (e: Entity, from: ChunkKey | undefined, to: ChunkKey | undefined) => void;
  /** ADR-212: bumped on every membership change, so interest can skip rebuilding unchanged per-client sets. */
  version = 0;
  /** ADR-212: last numeric chunk per entity (skips the per-tick "cx,cy" string for entities moving inside their chunk). */
  private packed = new Map<Entity, number>();
  constructor(private world: World) {}
  entitiesIn(k: ChunkKey): ReadonlySet<Entity> { return this.byChunk.get(k) ?? EMPTY; }
  chunkOf(e: Entity): ChunkKey | undefined { return this.chunkOfEntity.get(e); }
  get size(): number { return this.chunkOfEntity.size; }
  set(e: Entity, k: ChunkKey | undefined): void {
    const old = this.chunkOfEntity.get(e); if (old === k) return;
    if (old !== undefined) { const s = this.byChunk.get(old)!; s.delete(e); if (!s.size) this.byChunk.delete(old); }
    this.version++; this.packed.delete(e);
    if (k === undefined) this.chunkOfEntity.delete(e);
    else { this.chunkOfEntity.set(e, k); let s = this.byChunk.get(k); if (!s) this.byChunk.set(k, (s = new Set())); s.add(e); }
    this.onMove?.(e, old, k);
  }
  /** Apply this tick's Transform changes/removals (call in postSim). O(changed). */
  update(): void {
    const w = this.world; const st = w.store(Transform);
    for (const e of w.removed(Transform)) if (!w.has(e, Transform)) this.set(e, undefined);
    for (const i of st.changedIndices()) {
      const s = st.slot(i); const e = st.dense[s]!; const x = st.data.x[s]!, y = st.data.y[s]!;
      const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE); const p = cx * 1048576 + cy;
      if (cx === cx && cy === cy && this.packed.get(e) === p && this.chunkOfEntity.has(e)) continue;
      this.set(e, chunkKeyOf(x, y)); if (this.chunkOfEntity.has(e)) this.packed.set(e, p);
    }
  }
  rebuild(): void {
    for (const e of [...this.chunkOfEntity.keys()]) this.set(e, undefined);
    const st = this.world.store(Transform);
    for (let k = 0; k < st.size; k++) this.set(st.dense[k]!, chunkKeyOf(st.data.x[k]!, st.data.y[k]!));
  }
  /** Entity index helper for callers holding raw indices. */
  static indexOf = entityIndex;
}
const EMPTY: ReadonlySet<Entity> = new Set();
