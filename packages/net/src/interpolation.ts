const TAU = Math.PI * 2;
/** Max change of an entity's adaptive render lag per sample() call (ticks): playback speed varies by at most this fraction. */
const LAG_SLEW = 0.1;
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/**
 * Per-entity snapshot buffer for remote entities. Samples are (serverTick, values). `sample(t)` lerps
 * between the bracketing samples, extrapolates at most `maxExtrapolateTicks` past the newest, then holds.
 */
export class InterpolationBuffer {
  private samples = new Map<number, { tick: number; values: number[] }[]>();
  /** ADR-192: newest snapshot tick that carried an entity's previous values (not resent: throttled, budget-deferred or at rest). */
  private held = new Map<number, number>();
  /** ADR-192: per-entity extra render lag (ticks) = real-sample spacing - 1, slewed by LAG_SLEW per sample() so speed stays smooth. */
  private lag = new Map<number, { cur: number; target: number }>();
  /**
   * @param bridgeTicks carried runs shorter than this are bridged by lerping to the next real sample (the server skipped
   *   sending a mover); longer runs mean the entity was at rest, so it stays pinned until the next sample.
   */
  constructor(readonly capacity = 32, readonly maxExtrapolateTicks = 1, private readonly angular: readonly boolean[] = [], readonly bridgeTicks = 8) {}
  /** A snapshot at `tick` carried this entity's values unchanged; no new sample (a duplicate would freeze a throttled mover). */
  hold(netId: number, tick: number): void { const h = this.held.get(netId); if (h === undefined || tick > h) this.held.set(netId, tick); }
  push(netId: number, tick: number, values: readonly number[]): void {
    let l = this.samples.get(netId); if (!l) { l = []; this.samples.set(netId, l); }
    const h = this.held.get(netId); this.held.delete(netId);
    const prev = l[l.length - 1];
    if (h !== undefined && prev && h > prev.tick && h < tick && h - prev.tick >= this.bridgeTicks) l.push({ tick: h, values: [...prev.values] }); // rested until h
    let i = l.length; while (i > 0 && l[i - 1]!.tick >= tick) i--;
    if (l[i]?.tick === tick) l[i] = { tick, values: [...values] }; else l.splice(i, 0, { tick, values: [...values] });
    if (l.length > this.capacity) l.splice(0, l.length - this.capacity);
    if (l.length >= 2) { // spacing of the newest real samples (> 1 while the server throttles/defers this entity)
      const gap = l[l.length - 1]!.tick - l[l.length - 2]!.tick; const target = gap <= this.bridgeTicks ? gap - 1 : 0;
      const g = this.lag.get(netId); if (g) g.target = target; else if (target > 0) this.lag.set(netId, { cur: 0, target });
    }
  }
  has(netId: number): boolean { return this.samples.has(netId); }
  remove(netId: number): void { this.samples.delete(netId); this.held.delete(netId); this.lag.delete(netId); }
  ids(): IterableIterator<number> { return this.samples.keys(); }
  sample(netId: number, tick: number): number[] | undefined {
    const l = this.samples.get(netId); if (!l || l.length === 0) return undefined;
    const g = this.lag.get(netId);
    if (g) { g.cur += Math.max(-LAG_SLEW, Math.min(LAG_SLEW, g.target - g.cur)); tick -= g.cur; }
    const first = l[0]!; if (tick <= first.tick || l.length === 1) return [...(tick <= first.tick ? first : l[l.length - 1]!).values];
    const last = l[l.length - 1]!;
    if (tick >= last.tick) {
      const h = this.held.get(netId);
      if (h !== undefined && (tick <= h || h - last.tick >= this.bridgeTicks)) return [...last.values]; // covered by a received snapshot, or at rest: no guessing
      const prev = l[l.length - 2]!;
      const ex = Math.min(tick - last.tick, this.maxExtrapolateTicks);
      return this.mix(prev, last, 1 + ex / (last.tick - prev.tick));
    }
    let k = l.length - 1; while (l[k - 1]!.tick > tick) k--;
    const a = l[k - 1]!, b = l[k]!;
    return this.mix(a, b, (tick - a.tick) / (b.tick - a.tick));
  }
  private mix(a: { values: number[] }, b: { values: number[] }, t: number): number[] {
    return a.values.map((v, i) => (this.angular[i] ? lerpAngle(v, b.values[i]!, t) : v + (b.values[i]! - v) * t));
  }
}
