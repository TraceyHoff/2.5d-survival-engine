import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { chunkKeyOf, type ChunkKey } from "./chunk.js";

/** Per-chunk entity membership from Transform, maintained incrementally from change/removal records. */
export class ChunkMembership {
  private byChunk = new Map<ChunkKey, Set<Entity>>();
  private chunkOfEntity = new Map<Entity, ChunkKey>();
  /** Fired when an entity's chunk changes (from undefined on first sight, to undefined on removal). */
  onMove?: (e: Entity, from: ChunkKey | undefined, to: ChunkKey | undefined) => void;
  constructor(private world: World) {}
  entitiesIn(k: ChunkKey): ReadonlySet<Entity> { return this.byChunk.get(k) ?? EMPTY; }
  chunkOf(e: Entity): ChunkKey | undefined { return this.chunkOfEntity.get(e); }
  get size(): number { return this.chunkOfEntity.size; }
  set(e: Entity, k: ChunkKey | undefined): void {
    const old = this.chunkOfEntity.get(e); if (old === k) return;
    if (old !== undefined) { const s = this.byChunk.get(old)!; s.delete(e); if (!s.size) this.byChunk.delete(old); }
    if (k === undefined) this.chunkOfEntity.delete(e);
    else { this.chunkOfEntity.set(e, k); let s = this.byChunk.get(k); if (!s) this.byChunk.set(k, (s = new Set())); s.add(e); }
    this.onMove?.(e, old, k);
  }
  /** Apply this tick's Transform changes/removals (call in postSim). O(changed). */
  update(): void {
    const w = this.world; const st = w.store(Transform);
    for (const e of w.removed(Transform)) if (!w.has(e, Transform)) this.set(e, undefined);
    for (const i of st.changedIndices()) { const s = st.slot(i); this.set(st.dense[s]!, chunkKeyOf(st.data.x[s]!, st.data.y[s]!)); }
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
