/** Deterministic seeded PRNG (mulberry32). State is a single uint32, so it is trivially snapshot-able. */
export class Rng {
  state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  nextU32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  next(): number { return this.nextU32() / 4294967296; }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
  int(min: number, maxExclusive: number): number { return min + Math.floor(this.next() * (maxExclusive - min)); }
  pick<T>(arr: readonly T[]): T { if (!arr.length) throw new Error("pick from empty"); return arr[this.int(0, arr.length)]!; }
  fork(): Rng { return new Rng(this.nextU32()); }
}
