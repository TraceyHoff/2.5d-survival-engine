const TAU = Math.PI * 2;
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
  constructor(readonly capacity = 32, readonly maxExtrapolateTicks = 1, private readonly angular: readonly boolean[] = []) {}
  push(netId: number, tick: number, values: readonly number[]): void {
    let l = this.samples.get(netId); if (!l) { l = []; this.samples.set(netId, l); }
    let i = l.length; while (i > 0 && l[i - 1]!.tick >= tick) i--;
    if (l[i]?.tick === tick) l[i] = { tick, values: [...values] }; else l.splice(i, 0, { tick, values: [...values] });
    if (l.length > this.capacity) l.splice(0, l.length - this.capacity);
  }
  has(netId: number): boolean { return this.samples.has(netId); }
  remove(netId: number): void { this.samples.delete(netId); }
  ids(): IterableIterator<number> { return this.samples.keys(); }
  sample(netId: number, tick: number): number[] | undefined {
    const l = this.samples.get(netId); if (!l || l.length === 0) return undefined;
    const first = l[0]!; if (tick <= first.tick || l.length === 1) return [...(tick <= first.tick ? first : l[l.length - 1]!).values];
    const last = l[l.length - 1]!;
    if (tick >= last.tick) {
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
