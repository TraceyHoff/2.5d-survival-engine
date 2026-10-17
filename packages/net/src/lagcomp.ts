import { Transform, entityIndex, type Entity, type World } from "@engine/core";

export interface Vec3 { x: number; y: number; z: number }

/**
 * Server-side per-entity position history for lag compensation. Records Transform only when it changes
 * (sparse, so static entities cost nothing), keeping the last `capacity` changes per entity and
 * nothing older than `windowTicks` (default 1 s at 20 Hz). Call record() in the network phase (NetServer does).
 */
export class PositionHistory {
  private hist = new Map<number, { e: Entity; ticks: number[]; pos: number[] }>();
  constructor(private readonly world: World, readonly windowTicks = 20, readonly capacity = 24) {}
  record(): void {
    const w = this.world; const st = w.store(Transform); const tick = w.tick;
    for (const e of w.removed(Transform)) if (!w.has(e, Transform)) this.hist.delete(entityIndex(e));
    for (const i of st.changedIndices()) {
      const s = st.slot(i); const e = st.dense[s]!;
      let h = this.hist.get(i);
      if (!h || h.e !== e) { h = { e, ticks: [], pos: [] }; this.hist.set(i, h); }
      if (h.ticks[h.ticks.length - 1] === tick) { h.ticks.pop(); h.pos.splice(-3); }
      h.ticks.push(tick); h.pos.push(st.data.x[s]!, st.data.y[s]!, st.data.z[s]!);
      if (h.ticks.length > this.capacity) { h.ticks.shift(); h.pos.splice(0, 3); }
    }
  }
  /**
   * Position of `entity` as of the end of server tick `tick` (fractional ticks interpolate).
   * Undefined if the entity is unknown or `tick` is outside the window / older than retained history.
   */
  getPositionAt(entity: Entity, tick: number): Vec3 | undefined {
    const now = this.world.tick;
    if (tick > now || tick < now - this.windowTicks) return undefined;
    const h = this.hist.get(entityIndex(entity));
    if (!h || h.e !== entity || !this.world.isAlive(entity)) return undefined;
    const at = (k: number): Vec3 => ({ x: h.pos[k * 3]!, y: h.pos[k * 3 + 1]!, z: h.pos[k * 3 + 2]! });
    let k = h.ticks.length - 1; while (k >= 0 && h.ticks[k]! > tick) k--;
    if (k < 0) return undefined; // history overwritten
    const a = at(k);
    const next = h.ticks[k + 1];
    // Constant until the next recorded change; between next-1 and next (fractional view ticks) interpolate.
    if (next === undefined || tick <= next - 1) return a;
    const b = at(k + 1); const t = tick - (next - 1);
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
