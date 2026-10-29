/**
 * ADR-214: fixed-capacity struct-of-arrays particle pool. No per-particle objects, no growth: spawn writes typed-array
 * slots, update swap-removes dead ones. A budget (<= capacity) caps live particles; priority spawns (gameplay feedback:
 * hits, muzzle flashes, explosions) steal the oldest-ish slot when full, everything else is dropped, and ambient spawns
 * stop at 60% of the budget so they never crowd out feedback.
 */
export const Shape = { Glow: 0, Spark: 1, Shard: 2, Ring: 3, Smoke: 4, Star: 5, Drop: 6, Leaf: 7, Streak: 8, Arc: 9, Flame: 10, Beam: 11 } as const;
export const SHAPES = 12;
export const PF = { Add: 1, Bounce: 2, Stretch: 4, Prio: 8, Ambient: 16, Flat: 32, Blink: 64, FadeIn: 128 } as const;

export interface PoolStats { spawned: number; dropped: number; stolen: number; peak: number; active: number }

export class ParticlePool {
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array; readonly gz: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly age: Float32Array; readonly life: Float32Array; readonly s0: Float32Array; readonly s1: Float32Array; readonly a0: Float32Array;
  readonly drag: Float32Array; readonly grav: Float32Array; readonly rot: Float32Array; readonly vrot: Float32Array;
  /** Shape-specific extra: Streak tail (x2,y2,z2); Arc sweep (x2 = sweep radians, y2 = radius tiles). */
  readonly x2: Float32Array; readonly y2: Float32Array; readonly z2: Float32Array;
  readonly shape: Uint8Array; readonly color: Uint8Array; readonly flags: Uint8Array;
  private readonly f32: Float32Array[]; private readonly u8: Uint8Array[];
  count = 0; private budget_: number; private cursor = 0;
  readonly stats: PoolStats = { spawned: 0, dropped: 0, stolen: 0, peak: 0, active: 0 };
  /** Set by the governor: ambient spawns refused while true. */
  shedAmbient = false;
  constructor(readonly capacity = 2048, budget = capacity) {
    const f = (): Float32Array => new Float32Array(capacity), b = (): Uint8Array => new Uint8Array(capacity);
    this.px = f(); this.py = f(); this.pz = f(); this.gz = f(); this.vx = f(); this.vy = f(); this.vz = f(); this.age = f(); this.life = f();
    this.s0 = f(); this.s1 = f(); this.a0 = f(); this.drag = f(); this.grav = f(); this.rot = f(); this.vrot = f(); this.x2 = f(); this.y2 = f(); this.z2 = f();
    this.shape = b(); this.color = b(); this.flags = b();
    this.f32 = [this.px, this.py, this.pz, this.gz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.a0, this.drag, this.grav, this.rot, this.vrot, this.x2, this.y2, this.z2];
    this.u8 = [this.shape, this.color, this.flags];
    this.budget_ = Math.max(0, Math.min(capacity, budget));
  }
  get budget(): number { return this.budget_; }
  set budget(n: number) { this.budget_ = Math.max(0, Math.min(this.capacity, Math.round(n))); while (this.count > this.budget_) this.kill(this.count - 1); }
  /** Spawn one particle; returns its slot or -1 when refused. z is absolute (terrain z units), gz the floor it lands on.
   *  Convenience form for cold paths/tests: hot paths stage into S and call spawnS (doubles passed across a non-inlined
   *  call are boxed as HeapNumbers, ~16 B each, so a 16-arg spawn would allocate per particle). */
  spawn(shape: number, color: number, flags: number, x: number, y: number, z: number, gz: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number, drag = 0, grav = 0): number {
    S[0] = x; S[1] = y; S[2] = z; S[3] = gz; S[4] = vx; S[5] = vy; S[6] = vz; S[7] = life; S[8] = s0; S[9] = s1; S[10] = a0; S[11] = drag; S[12] = grav;
    return this.spawnS(shape, color, flags);
  }
  /** Spawn from the shared staging buffer S (x,y,z,gz,vx,vy,vz,life,s0,s1,a0,drag,grav): only small ints cross the call, so no per-particle allocation. */
  spawnS(shape: number, color: number, flags: number): number {
    let i: number;
    if (this.count < this.budget_ && !((flags & PF.Ambient) && (this.shedAmbient || this.count >= this.budget_ * 0.6))) i = this.count++;
    else if ((flags & PF.Prio) && this.count > 0) { i = this.cursor % this.count; this.cursor = (this.cursor + 7) % 0x7fffffff; this.stats.stolen++; }
    else { this.stats.dropped++; return -1; }
    const b = S, life = b[7]!;
    this.px[i] = b[0]!; this.py[i] = b[1]!; this.pz[i] = b[2]!; this.gz[i] = b[3]!; this.vx[i] = b[4]!; this.vy[i] = b[5]!; this.vz[i] = b[6]!;
    this.age[i] = 0; this.life[i] = life > 0.01 ? life : 0.01; this.s0[i] = b[8]!; this.s1[i] = b[9]!; this.a0[i] = b[10]!; this.drag[i] = b[11]!; this.grav[i] = b[12]!;
    this.rot[i] = 0; this.vrot[i] = 0; this.x2[i] = 0; this.y2[i] = 0; this.z2[i] = 0; this.shape[i] = shape; this.color[i] = color; this.flags[i] = flags;
    this.stats.spawned++; if (this.count > this.stats.peak) this.stats.peak = this.count;
    return i;
  }
  private kill(i: number): void {
    const last = --this.count; if (i !== last) { const f = this.f32, u = this.u8; for (let k = 0; k < f.length; k++) { const a = f[k]!; a[i] = a[last]!; } for (let k = 0; k < u.length; k++) { const a = u[k]!; a[i] = a[last]!; } }
  }
  /** Advance by dt seconds (already time-scaled). */
  update(dt: number): void {
    const { px, py, pz, gz, vx, vy, vz, age, life, drag, grav, rot, vrot, flags } = this;
    for (let i = 0; i < this.count;) {
      const a = age[i]! + dt; if (a >= life[i]!) { this.kill(i); continue; }
      age[i] = a;
      const d = drag[i]!; if (d > 0) { const k = d * dt >= 1 ? 0 : 1 - d * dt; vx[i]! *= k; vy[i]! *= k; vz[i]! *= k; }
      vz[i]! -= grav[i]! * dt;
      px[i]! += vx[i]! * dt; py[i]! += vy[i]! * dt; pz[i]! += vz[i]! * dt; rot[i]! += vrot[i]! * dt;
      if (pz[i]! < gz[i]!) {
        if (flags[i]! & PF.Bounce) { pz[i] = gz[i]!; vz[i] = -vz[i]! * 0.3; vx[i]! *= 0.55; vy[i]! *= 0.55; vrot[i]! *= 0.5; if (vz[i]! < 0.4) vz[i] = 0; }
        else if (grav[i]! > 0) { pz[i] = gz[i]!; vx[i] = 0; vy[i] = 0; vz[i] = 0; }
      }
      i++;
    }
    this.stats.active = this.count;
  }
  clear(): void { this.count = 0; this.stats.active = 0; }
}

/** ADR-214 spawn staging buffer (see spawnS). */
export const S = new Float64Array(13);
