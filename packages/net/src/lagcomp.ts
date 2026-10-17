import { Transform, entityIndex, type Entity, type World } from "@engine/core";

export interface Vec3 { x: number; y: number; z: number }

/**
 * Server-side per-entity position history for lag compensation (net owns it; core has no Transform history).
 * Sparse: records Transform only when it changes, into a fixed per-entity ring (`capacity` samples, typed arrays),
 * nothing older than `windowTicks`. Entities idle for a whole window are purged (an entity with no history is
 * answered from its current Transform: it has not moved inside the window). `track` limits recording to hittable
 * entities (e.g. has Health), so 10k+ moving props cost nothing. Memory: tracked movers x capacity x 16 B.
 * NetServer calls record() in the network phase.
 */
interface Ring { e: Entity; ticks: Int32Array; pos: Float32Array; head: number; len: number; last: number }
export class PositionHistory {
  private hist = new Map<number, Ring>();
  /** Recording filter (default: every entity with Transform). */
  track: ((world: World, e: Entity) => boolean) | undefined;
  constructor(private readonly world: World, readonly windowTicks = 20, readonly capacity = 24) {}
  get trackedCount(): number { return this.hist.size; }
  record(): void {
    const w = this.world; const st = w.store(Transform); const tick = w.tick; const cap = this.capacity;
    for (const e of w.removed(Transform)) if (!w.has(e, Transform)) this.hist.delete(entityIndex(e));
    for (const i of st.changedIndices()) {
      const s = st.slot(i); const e = st.dense[s]!;
      if (this.track && !this.track(w, e)) continue;
      let h = this.hist.get(i);
      if (!h || h.e !== e) { h = { e, ticks: new Int32Array(cap), pos: new Float32Array(cap * 3), head: 0, len: 0, last: -1 }; this.hist.set(i, h); }
      let k: number;
      if (h.len && h.last === tick) k = (h.head + h.len - 1) % cap; // overwrite this tick's sample
      else if (h.len < cap) { k = (h.head + h.len) % cap; h.len++; }
      else { k = h.head; h.head = (h.head + 1) % cap; }
      h.ticks[k] = tick; h.pos[k * 3] = st.data.x[s]!; h.pos[k * 3 + 1] = st.data.y[s]!; h.pos[k * 3 + 2] = st.data.z[s]!; h.last = tick;
    }
    if (tick % 64 === 0) for (const [i, h] of this.hist) if (h.last < tick - this.windowTicks - 1 || !w.isAlive(h.e)) this.hist.delete(i);
  }
  /**
   * Position of `entity` as of the end of server tick `tick` (fractional ticks interpolate).
   * Undefined if the entity is unknown/dead or `tick` is outside the window / older than retained history.
   */
  getPositionAt(entity: Entity, tick: number): Vec3 | undefined {
    const w = this.world; const now = w.tick;
    if (tick > now || tick < now - this.windowTicks || !w.isAlive(entity)) return undefined;
    const h = this.hist.get(entityIndex(entity));
    if (!h || h.e !== entity) {
      if (this.track && !this.track(w, entity)) return undefined;
      const t = w.get(entity, Transform); return t ? { x: t.x, y: t.y, z: t.z } : undefined; // idle all window
    }
    const cap = this.capacity; const idx = (j: number): number => (h.head + j) % cap;
    const at = (j: number): Vec3 => { const k = idx(j); return { x: h.pos[k * 3]!, y: h.pos[k * 3 + 1]!, z: h.pos[k * 3 + 2]! }; };
    let j = h.len - 1; while (j >= 0 && h.ticks[idx(j)]! > tick) j--;
    if (j < 0) return undefined; // history overwritten
    const a = at(j);
    if (j + 1 >= h.len) return a;
    const next = h.ticks[idx(j + 1)]!;
    // Constant until the next recorded change; between next-1 and next (fractional view ticks) interpolate.
    if (tick <= next - 1) return a;
    const b = at(j + 1); const t = tick - (next - 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
}

export interface RangeSlack {
  /** Fixed tolerance in tiles (float error, quantization). Default 0.25. */
  slack?: number;
  /** Actor's max speed (tiles/s) and how many ticks the client may be ahead (predicted vs server). */
  maxSpeed?: number; leadTicks?: number; dt?: number;
}
/**
 * Range check against a static target, tolerant of the client's prediction lead:
 * dist2D(actor, target) <= range + slack + maxSpeed * leadTicks * dt.
 */
export function rangeCheckWithSlack(actor: { x: number; y: number }, target: { x: number; y: number }, range: number, o: RangeSlack = {}): boolean {
  const lim = range + (o.slack ?? 0.25) + (o.maxSpeed ?? 0) * (o.leadTicks ?? 0) * (o.dt ?? 1 / 20);
  const dx = actor.x - target.x, dy = actor.y - target.y;
  return dx * dx + dy * dy <= lim * lim;
}
