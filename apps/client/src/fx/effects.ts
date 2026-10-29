/**
 * ADR-214: effect recipes (what a hit / explosion / footstep looks like) on top of the pooled particles, plus the
 * screen state (shake trauma, hit-stop, vignettes, light flicker, fog roll-in, flash, god rays). Pure logic: no DOM,
 * no allocation per spawn; the overlay (draw.ts) renders it and fx/index.ts feeds it.
 */
import { ParticlePool, Shape, PF, S } from "./pool.js";
import { C } from "./palette.js";

export type ImpactMat = "ichor" | "blood" | "spark" | "metal" | "wood" | "stone" | "sizzle" | "fire" | "soot" | "fur";
export type Surface = "grass" | "sand" | "dirt" | "water" | "stone" | "wood" | "snow";
const TAU = Math.PI * 2;
/** Height of a character's chest above its feet (z units; 1 z = 16 px, a character is ~3 z tall). */
export const CHEST = 1.7;

export class Fx {
  readonly pool: ParticlePool;
  /** Density multiplier (settings x 1); counts scale by this, the budget caps the total. */
  density = 1;
  // ---- screen state ----
  trauma = 0; shakeScale = 1; hitStopLeft = 0; hitStopOn = true; flickerOn = true;
  hurt = 0; hurtColor = 0; lowHp = 0; pulsePhase = 0; dread = 0; flash = 0; flashColor = 0;
  flickerLeft = 0; flickerDark = 0; fogAmt = 0; fogHold = 0; fogPeak = 0; rays = 0; raysTarget = 0; time = 0;
  /** Output each frame: camera shake in CSS px and the effects/renderer time scale. */
  shakeX = 0; shakeY = 0; timeScale = 1;
  /** PRNG state in a typed array: a uint32 object field above 2^31 is a boxed HeapNumber on every store. */
  private readonly seed = new Uint32Array([0x9e3779b9]);
  constructor(capacity = 2048, budget = 1400) { this.pool = new ParticlePool(capacity, budget); }
  /** xorshift32 in [0, 1). */
  rnd(): number { const st = this.seed; let x = st[0]! | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; st[0] = x; return st[0]! / 4294967296; }
  private r(a: number, b: number): number { return a + (b - a) * this.rnd(); }
  n(base: number): number { const v = base * this.density; const f = Math.floor(v); return f + (this.rnd() < v - f ? 1 : 0); }

  /** Per frame (real dt, seconds): screen-state decay; returns the scaled dt for particles. */
  step(dt: number): number {
    this.time += dt;
    this.hitStopLeft = Math.max(0, this.hitStopLeft - dt);
    this.timeScale = this.hitStopLeft > 0 && this.hitStopOn ? 0.12 : 1;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const m = this.trauma * this.trauma * 6 * this.shakeScale, t = this.time * 31;
    this.shakeX = m * (Math.sin(t * 1.13) * 0.6 + Math.sin(t * 2.71 + 1.3) * 0.4); this.shakeY = m * (Math.sin(t * 1.37 + 2.1) * 0.6 + Math.sin(t * 3.07 + 0.4) * 0.4);
    this.hurt = Math.max(0, this.hurt - dt * 1.6); this.flash = Math.max(0, this.flash - dt * 5); this.dread = Math.max(0, this.dread - dt * 0.22);
    this.pulsePhase = (this.pulsePhase + dt * (this.lowHp > 0 ? 1.15 + this.lowHp * 0.6 : 1)) % 1;
    if (this.flickerLeft > 0) { this.flickerLeft = Math.max(0, this.flickerLeft - dt);
      const k = this.flickerLeft / 1.4; this.flickerDark = this.flickerOn ? (Math.sin(this.time * 47) > 0.35 || Math.sin(this.time * 13.3) > 0.8 ? 0.34 * k : 0.06 * k) : 0.18 * Math.sin(Math.PI * (1 - k)); }
    else this.flickerDark = 0;
    if (this.fogHold > 0) { this.fogHold -= dt; this.fogAmt += (this.fogPeak - this.fogAmt) * Math.min(1, dt * 0.9); } else this.fogAmt = Math.max(0, this.fogAmt - dt * 0.09);
    this.rays += (this.raysTarget - this.rays) * Math.min(1, dt * 0.5);
    return dt * this.timeScale;
  }
  shake(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }
  hitStop(sec: number): void { if (this.hitStopOn) this.hitStopLeft = Math.max(this.hitStopLeft, Math.min(0.09, sec)); }

  // ---------------------------------------------------------------- combat
  private sx = 0; private sy = 0; private sz = 0; private sg = 0; private sdir = 0;
  /** Directional spray around the current impact point (set by impact()); a plain method (doubles stay unboxed once inlined). */
  private spray(count: number, col: number, shape: number, flags: number, spd: number, life: number, s: number, grav: number): void {
    const radial = Number.isNaN(this.sdir), cx = radial ? 0 : Math.cos(this.sdir), cy = radial ? 0 : Math.sin(this.sdir);
    for (let k = 0; k < count; k++) {
      const a = radial ? this.r(0, TAU) : this.sdir + this.r(-0.9, 0.9), v = spd * this.r(0.4, 1.1);
      ((S[0] = this.sx + cx * 0.15, S[1] = this.sy + cy * 0.15, S[2] = this.sz + this.r(-0.3, 0.3), S[3] = this.sg, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(1.5, 5), S[7] = life * this.r(0.7, 1.2), S[8] = s * this.r(0.7, 1.2), S[9] = s * 0.4, S[10] = 1, S[11] = 1.2, S[12] = grav), this.pool.spawnS(shape, col, flags | PF.Prio));
    }
  }
  /** Impact at a body: dir = travel direction of the hit (radians, tile axes; NaN = radial). heavy adds the crit flash. */
  impact(x: number, y: number, gz: number, dir: number, mat: ImpactMat, power: number, heavy: boolean): void {
    const p = this.pool, z = gz + CHEST; this.sx = x; this.sy = y; this.sz = z; this.sg = gz; this.sdir = dir;
    const n = Math.min(3, 0.6 + power);
    switch (mat) {
      case "ichor": case "blood": {
        const col = mat === "ichor" ? C.Ichor : C.Blood;
        this.spray(this.n(7 * n), col, Shape.Drop, PF.Stretch, 3.2, 0.7, 4, 22);
        this.spray(this.n(2 * n), col, Shape.Smoke, 0, 0.8, 0.45, 9, 0);
        break; }
      case "spark": case "metal": this.spray(this.n(9 * n), mat === "metal" ? C.Metal : C.Spark, Shape.Spark, PF.Add | PF.Stretch | PF.Bounce, 5, 0.35, 3, 18); break;
      case "wood": this.spray(this.n(6 * n), C.Wood, Shape.Shard, PF.Bounce, 3, 0.8, 4, 24); this.spray(this.n(2 * n), C.Dust, Shape.Smoke, 0, 0.6, 0.6, 10, 0); break;
      case "stone": this.spray(this.n(6 * n), C.Stone, Shape.Shard, PF.Bounce, 3.2, 0.8, 3.5, 26); this.spray(this.n(3 * n), C.Spark, Shape.Spark, PF.Add | PF.Stretch, 4, 0.25, 2.5, 10); this.spray(this.n(2 * n), C.Dust, Shape.Smoke, 0, 0.5, 0.7, 11, 0); break;
      case "sizzle": this.spray(this.n(5 * n), C.Steam, Shape.Smoke, 0, 0.5, 1.1, 9, -3); this.spray(this.n(4 * n), C.Ember, Shape.Glow, PF.Add, 1.2, 0.8, 3, -4); break;
      case "fire": this.spray(this.n(6 * n), C.Fire, Shape.Flame, PF.Add, 1, 0.5, 8, -6); this.spray(this.n(4 * n), C.Ember, Shape.Glow, PF.Add, 1.5, 0.9, 2.5, -3); break;
      case "soot": this.spray(this.n(5 * n), C.Soot, Shape.Smoke, 0, 1.2, 0.9, 12, -1); break;
      case "fur": this.spray(this.n(5 * n), C.Fur, Shape.Leaf, 0, 1.6, 0.9, 4, 6); this.spray(this.n(4 * n), C.Blood, Shape.Drop, PF.Bounce | PF.Stretch, 2.5, 0.6, 3.5, 22); break;
    }
    // bright core: every hit reads, whatever the source
    ((S[0] = x, S[1] = y, S[2] = z, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.12, S[8] = 10 + 6 * power, S[9] = 18 + 8 * power, S[10] = 0.55, S[11] = 0, S[12] = 0), p.spawnS(Shape.Glow, mat === "ichor" || mat === "blood" || mat === "fur" ? C.White : C.Spark, PF.Add | PF.Prio));
    if (heavy) this.crit(x, y, gz);
  }
  /** Heavy hit / killing blow: star flash + ring + white screen tick. */
  crit(x: number, y: number, gz: number): void {
    const p = this.pool, z = gz + CHEST;
    let i = ((S[0] = x, S[1] = y, S[2] = z, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.22, S[8] = 14, S[9] = 44, S[10] = 1, S[11] = 0, S[12] = 0), p.spawnS(Shape.Star, C.Crit, PF.Add | PF.Prio)); if (i >= 0) p.vrot[i] = 4;
    i = ((S[0] = x, S[1] = y, S[2] = gz + 0.1, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.3, S[8] = 6, S[9] = 46, S[10] = 0.7, S[11] = 0, S[12] = 0), p.spawnS(Shape.Ring, C.Crit, PF.Add | PF.Prio | PF.Flat));
    this.flash = Math.max(this.flash, 0.1); this.flashColor = C.Crit;
  }
  death(x: number, y: number, gz: number, mat: ImpactMat): void {
    const p = this.pool;
    this.impact(x, y, gz, NaN, mat, 2, false);
    for (let k = 0, n = this.n(6); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.3, 0.9);
      ((S[0] = x + Math.cos(a) * 0.2, S[1] = y + Math.sin(a) * 0.2, S[2] = gz + this.r(0.2, 1.2), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(0.6, 1.4), S[7] = this.r(0.8, 1.3), S[8] = 10, S[9] = 24, S[10] = 0.55, S[11] = 1.5, S[12] = -0.6), p.spawnS(Shape.Smoke, mat === "ichor" ? C.Soot : C.Smoke, PF.Prio)); }
    ((S[0] = x, S[1] = y, S[2] = gz + 0.05, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.5, S[8] = 8, S[9] = 40, S[10] = 0.5, S[11] = 0, S[12] = 0), p.spawnS(Shape.Ring, mat === "ichor" ? C.Ichor : C.Blood, PF.Prio | PF.Flat));
  }
  /** Melee swing arc in front of the attacker (facing radians). */
  swing(x: number, y: number, gz: number, facing: number, cls: string, zombie = false): void {
    const big = cls === "axe" || cls === "hammer" || cls === "club" || cls === "sledge" || cls === "spear" || cls === "machete" || cls === "sword";
    const i = ((S[0] = x, S[1] = y, S[2] = gz + CHEST - 0.2, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = zombie ? 0.18 : 0.2, S[8] = 1, S[9] = 1, S[10] = zombie ? 0.45 : big ? 0.75 : 0.5, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Arc, zombie ? C.Blood : cls === "fists" ? C.White : C.Crit, PF.Add | PF.Prio));
    if (i >= 0) { const sweep = big ? 2.2 : 1.6; this.pool.rot[i] = facing - sweep / 2; this.pool.x2[i] = sweep; this.pool.y2[i] = big ? 1.15 : cls === "fists" ? 0.6 : 0.9; }
  }
  muzzle(x: number, y: number, gz: number, facing: number, cls: string): void {
    const p = this.pool, gun = cls !== "bow" && cls !== "crossbow" && cls !== "sling", ox = x + Math.cos(facing) * 0.55, oy = y + Math.sin(facing) * 0.55, z = gz + CHEST;
    if (!gun) { ((S[0] = ox, S[1] = oy, S[2] = z, S[3] = gz, S[4] = Math.cos(facing) * 14, S[5] = Math.sin(facing) * 14, S[6] = 0, S[7] = 0.12, S[8] = 2, S[9] = 1, S[10] = 0.5, S[11] = 0, S[12] = 0), p.spawnS(Shape.Streak, C.White, PF.Add | PF.Prio)); return; }
    const s = cls === "shotgun" || cls === "musket" ? 1.5 : cls === "pistol" ? 0.9 : 1.15;
    ((S[0] = ox, S[1] = oy, S[2] = z, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.06, S[8] = 18 * s, S[9] = 10 * s, S[10] = 1, S[11] = 0, S[12] = 0), p.spawnS(Shape.Star, C.Muzzle, PF.Add | PF.Prio));
    ((S[0] = ox, S[1] = oy, S[2] = z, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.1, S[8] = 40 * s, S[9] = 20 * s, S[10] = 0.6, S[11] = 0, S[12] = 0), p.spawnS(Shape.Glow, C.Spark, PF.Add | PF.Prio));
    for (let k = 0, n = this.n(3 * s); k < n; k++) { const a = facing + this.r(-0.5, 0.5);
      ((S[0] = ox, S[1] = oy, S[2] = z, S[3] = gz, S[4] = Math.cos(a) * this.r(0.6, 1.6), S[5] = Math.sin(a) * this.r(0.6, 1.6), S[6] = this.r(0.3, 0.9), S[7] = this.r(0.6, 1.1), S[8] = 6, S[9] = 16, S[10] = 0.35, S[11] = 2, S[12] = -0.5), p.spawnS(Shape.Smoke, C.Smoke, 0)); }
    if (cls === "shotgun" || cls === "musket") this.shake(0.12);
  }
  /** Bullet / bolt tracer from the shooter to the hit (visible attribution for ranged and turret damage). */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, gun: boolean): void {
    const i = ((S[0] = x1, S[1] = y1, S[2] = z1, S[3] = z1, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = gun ? 0.09 : 0.14, S[8] = gun ? 2.2 : 1.6, S[9] = 0.6, S[10] = gun ? 0.85 : 0.6, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Streak, gun ? C.Muzzle : C.White, PF.Add | PF.Prio));
    if (i >= 0) { this.pool.x2[i] = x0; this.pool.y2[i] = y0; this.pool.z2[i] = z0; }
  }
  explosion(x: number, y: number, gz: number, fire: boolean): void {
    const p = this.pool;
    ((S[0] = x, S[1] = y, S[2] = gz + 1, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.25, S[8] = 60, S[9] = 150, S[10] = 1, S[11] = 0, S[12] = 0), p.spawnS(Shape.Glow, C.Crit, PF.Add | PF.Prio));
    ((S[0] = x, S[1] = y, S[2] = gz + 0.1, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.4, S[8] = 10, S[9] = 130, S[10] = 0.8, S[11] = 0, S[12] = 0), p.spawnS(Shape.Ring, C.Spark, PF.Add | PF.Prio | PF.Flat));
    for (let k = 0, n = this.n(14); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.5, 2.4);
      ((S[0] = x, S[1] = y, S[2] = gz + this.r(0.3, 1.5), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(1, 4), S[7] = this.r(0.35, 0.7), S[8] = this.r(14, 24), S[9] = 6, S[10] = 0.95, S[11] = 2.5, S[12] = -2), p.spawnS(Shape.Flame, C.Fire, PF.Add | PF.Prio)); }
    for (let k = 0, n = this.n(14); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.4, 1.6);
      ((S[0] = x, S[1] = y, S[2] = gz + this.r(0.5, 2), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(1, 3), S[7] = this.r(1.4, 2.6), S[8] = this.r(14, 22), S[9] = this.r(36, 56), S[10] = 0.6, S[11] = 1.1, S[12] = -0.8), p.spawnS(Shape.Smoke, C.Soot, PF.Prio)); }
    for (let k = 0, n = this.n(16); k < n; k++) { const a = this.r(0, TAU), v = this.r(3, 7);
      const i = ((S[0] = x, S[1] = y, S[2] = gz + 0.8, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(4, 9), S[7] = this.r(0.8, 1.4), S[8] = 4, S[9] = 3, S[10] = 1, S[11] = 0.6, S[12] = 26), p.spawnS(Shape.Shard, k & 1 ? C.Stone : C.Soot, PF.Bounce | PF.Prio)); if (i >= 0) p.vrot[i] = this.r(-12, 12); }
    for (let k = 0, n = this.n(fire ? 26 : 12); k < n; k++) { const a = this.r(0, TAU), v = this.r(2, 6);
      ((S[0] = x, S[1] = y, S[2] = gz + 1, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(3, 8), S[7] = this.r(0.6, 1.6), S[8] = 3, S[9] = 1, S[10] = 1, S[11] = 1, S[12] = 8), p.spawnS(Shape.Spark, C.Ember, PF.Add | PF.Stretch | PF.Prio)); }
    this.flash = Math.max(this.flash, 0.35); this.flashColor = C.Fire; this.shake(0.55); this.hitStop(0.06);
  }

  // ---------------------------------------------------------------- world interaction
  footstep(x: number, y: number, gz: number, surf: Surface, run: boolean, facing: number): void {
    const p = this.pool;
    if (surf === "water") { this.splash(x, y, gz, run ? 0.8 : 0.5); return; }
    if (surf === "wood" || surf === "stone") { if (!run) return; }
    const col = surf === "sand" ? C.Sand : surf === "grass" ? C.Grass : surf === "snow" ? C.White : C.Dust;
    for (let k = 0, n = this.n(run ? 3 : 1.4); k < n; k++) { const a = facing + Math.PI + this.r(-1, 1), v = this.r(0.3, run ? 1.1 : 0.6);
      ((S[0] = x + this.r(-0.12, 0.12), S[1] = y + this.r(-0.12, 0.12), S[2] = gz + 0.1, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(0.3, 0.9), S[7] = this.r(0.45, 0.8), S[8] = 5, S[9] = run ? 13 : 10, S[10] = surf === "grass" ? 0.28 : 0.42, S[11] = 2.2, S[12] = -0.4), p.spawnS(Shape.Smoke, col, 0)); }
  }
  splash(x: number, y: number, gz: number, power: number): void {
    const p = this.pool;
    for (let k = 0, n = this.n(5 * power + 1); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.4, 1.2);
      ((S[0] = x, S[1] = y, S[2] = gz + 0.1, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(3, 6) * power + 1, S[7] = this.r(0.35, 0.6), S[8] = 2.5, S[9] = 1.5, S[10] = 0.75, S[11] = 0, S[12] = 24), p.spawnS(Shape.Drop, C.Water, PF.Stretch)); }
    this.ripple(x, y, gz, 0.6 + power);
  }
  ripple(x: number, y: number, gz: number, size: number, ambient = false): void {
    ((S[0] = x, S[1] = y, S[2] = gz + 0.02, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.9 * size, S[8] = 3, S[9] = 22 * size, S[10] = ambient ? 0.35 : 0.5, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Ring, C.Water, PF.Flat | (ambient ? PF.Ambient : 0)));
  }
  wake(x: number, y: number, gz: number, facing: number): void {
    const p = this.pool, bx = x - Math.cos(facing) * 0.35, by = y - Math.sin(facing) * 0.35;
    ((S[0] = bx, S[1] = by, S[2] = gz + 0.02, S[3] = gz, S[4] = -Math.cos(facing) * 0.25, S[5] = -Math.sin(facing) * 0.25, S[6] = 0, S[7] = 1.3, S[8] = 6, S[9] = 30, S[10] = 0.45, S[11] = 0, S[12] = 0), p.spawnS(Shape.Ring, C.Water, PF.Flat));
    for (let s = -1; s <= 1; s += 2) { const a = facing + Math.PI + s * 0.55;
      ((S[0] = bx, S[1] = by, S[2] = gz + 0.1, S[3] = gz, S[4] = Math.cos(a) * 0.9, S[5] = Math.sin(a) * 0.9, S[6] = 2, S[7] = 0.4, S[8] = 2, S[9] = 1, S[10] = 0.6, S[11] = 0, S[12] = 14), p.spawnS(Shape.Drop, C.Water, PF.Stretch)); }
  }
  /** Extra chips on top of gather-fx's art chips (ADR-128): ore glints + sparks for mining, bark dust for chopping. */
  gather(x: number, y: number, gz: number, kind: string, dir: number): void {
    const p = this.pool;
    if (kind === "mine") { for (let k = 0, n = this.n(6); k < n; k++) { const a = dir + Math.PI + this.r(-1.2, 1.2), v = this.r(2, 4.5);
      ((S[0] = x, S[1] = y, S[2] = gz + 0.9, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(2, 5), S[7] = this.r(0.25, 0.5), S[8] = 2.5, S[9] = 1, S[10] = 1, S[11] = 1, S[12] = 16), p.spawnS(Shape.Spark, k % 3 ? C.Spark : C.Ore, PF.Add | PF.Stretch | PF.Bounce | PF.Prio)); }
      ((S[0] = x + this.r(-0.2, 0.2), S[1] = y + this.r(-0.2, 0.2), S[2] = gz + this.r(0.5, 1.4), S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.3, S[8] = 4, S[9] = 12, S[10] = 0.9, S[11] = 0, S[12] = 0), p.spawnS(Shape.Star, C.Ore, PF.Add | PF.Prio)); }
    else if (kind === "chop") { for (let k = 0, n = this.n(4); k < n; k++) { const a = dir + Math.PI + this.r(-1, 1), v = this.r(1.2, 2.5);
      const i = ((S[0] = x, S[1] = y, S[2] = gz + 1, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(2, 4), S[7] = this.r(0.6, 1), S[8] = 3.5, S[9] = 3, S[10] = 1, S[11] = 0.8, S[12] = 22), p.spawnS(Shape.Shard, C.Wood, PF.Bounce | PF.Prio)); if (i >= 0) p.vrot[i] = this.r(-10, 10); }
      ((S[0] = x, S[1] = y, S[2] = gz + 1, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0.3, S[7] = 0.6, S[8] = 6, S[9] = 14, S[10] = 0.3, S[11] = 1, S[12] = 0), p.spawnS(Shape.Smoke, C.Dust, 0)); }
    else for (let k = 0, n = this.n(3); k < n; k++) { const a = this.r(0, TAU); ((S[0] = x, S[1] = y, S[2] = gz + 0.8, S[3] = gz, S[4] = Math.cos(a), S[5] = Math.sin(a), S[6] = this.r(1, 2), S[7] = this.r(0.8, 1.2), S[8] = 4, S[9] = 3, S[10] = 1, S[11] = 1, S[12] = 3), p.spawnS(Shape.Leaf, C.Leaf, 0)); }
  }
  treeFall(x: number, y: number, gz: number, autumn: boolean): void {
    const p = this.pool;
    for (let k = 0, n = this.n(26); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.4, 2.2);
      const i = ((S[0] = x + this.r(-0.6, 0.6), S[1] = y + this.r(-0.6, 0.6), S[2] = gz + this.r(2, 5), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(-0.5, 1), S[7] = this.r(1.4, 2.6), S[8] = 4.5, S[9] = 4, S[10] = 1, S[11] = 1.4, S[12] = 1.6), p.spawnS(Shape.Leaf, autumn || k % 4 === 0 ? C.Autumn : C.Leaf, PF.Prio));
      if (i >= 0) p.vrot[i] = this.r(-5, 5); }
    this.dustRing(x, y, gz, 1.3, C.Dust); this.shake(0.3);
  }
  rockBreak(x: number, y: number, gz: number): void {
    const p = this.pool;
    for (let k = 0, n = this.n(18); k < n; k++) { const a = this.r(0, TAU), v = this.r(1.5, 4);
      const i = ((S[0] = x, S[1] = y, S[2] = gz + this.r(0.4, 1.2), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(3, 7), S[7] = this.r(0.9, 1.5), S[8] = this.r(3.5, 6), S[9] = 4, S[10] = 1, S[11] = 0.6, S[12] = 26), p.spawnS(Shape.Shard, C.Stone, PF.Bounce | PF.Prio)); if (i >= 0) p.vrot[i] = this.r(-12, 12); }
    this.dustRing(x, y, gz, 1.2, C.Dust); this.shake(0.25);
  }
  dustRing(x: number, y: number, gz: number, size: number, col: number): void {
    const p = this.pool;
    for (let k = 0, n = this.n(10 * size); k < n; k++) { const a = (k / Math.max(1, n)) * TAU + this.r(-0.2, 0.2), v = this.r(0.9, 1.6) * size;
      ((S[0] = x + Math.cos(a) * 0.3, S[1] = y + Math.sin(a) * 0.3, S[2] = gz + 0.15, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(0.2, 0.6), S[7] = this.r(0.6, 1.1), S[8] = 8 * size, S[9] = 20 * size, S[10] = 0.5, S[11] = 2.6, S[12] = -0.2), p.spawnS(Shape.Smoke, col, 0)); }
  }
  /** Build piece placed: dust ring puff + a snap flash outline glow. */
  buildPlace(x: number, y: number, gz: number, mat: string): void {
    this.dustRing(x, y, gz, 1, mat === "stone" ? C.Stone : C.Dust);
    ((S[0] = x, S[1] = y, S[2] = gz + 0.05, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.35, S[8] = 20, S[9] = 44, S[10] = 0.55, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Ring, C.Crit, PF.Add | PF.Flat));
    ((S[0] = x, S[1] = y, S[2] = gz + 1, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.18, S[8] = 30, S[9] = 50, S[10] = 0.35, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Glow, C.White, PF.Add));
  }
  buildBreak(x: number, y: number, gz: number, mat: string): void {
    const p = this.pool, col = mat === "stone" ? C.Stone : mat === "metal" ? C.Metal : C.Wood;
    for (let k = 0, n = this.n(18); k < n; k++) { const a = this.r(0, TAU), v = this.r(1.5, 4);
      const i = ((S[0] = x + this.r(-0.3, 0.3), S[1] = y + this.r(-0.3, 0.3), S[2] = gz + this.r(0.5, 2.5), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(2, 6), S[7] = this.r(0.9, 1.6), S[8] = this.r(4, 7), S[9] = 4, S[10] = 1, S[11] = 0.5, S[12] = 24), p.spawnS(Shape.Shard, col, PF.Bounce | PF.Prio)); if (i >= 0) p.vrot[i] = this.r(-12, 12); }
    if (mat === "metal") this.impact(x, y, gz, NaN, "metal", 1.5, false);
    this.dustRing(x, y, gz, 1.4, mat === "stone" ? C.Stone : C.Dust); this.shake(0.2);
  }
  structureHit(x: number, y: number, gz: number, mat: string): void { this.impact(x, y, gz - 0.4, NaN, mat === "stone" ? "stone" : mat === "metal" ? "metal" : "wood", 0.7, false); }
  sparkle(x: number, y: number, gz: number, col: number, big = false): void {
    const p = this.pool;
    for (let k = 0, n = this.n(big ? 12 : 4); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.2, big ? 1.2 : 0.6);
      const i = ((S[0] = x + this.r(-0.3, 0.3), S[1] = y + this.r(-0.3, 0.3), S[2] = gz + this.r(0.8, 2.2), S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(0.5, 1.6), S[7] = this.r(0.5, 1), S[8] = this.r(5, 9), S[9] = 2, S[10] = 1, S[11] = 1.2, S[12] = -0.6), p.spawnS(Shape.Star, col, PF.Add | PF.Prio | PF.Blink)); if (i >= 0) p.vrot[i] = this.r(-3, 3); }
  }
  steam(x: number, y: number, gz: number): void {
    for (let k = 0, n = this.n(5); k < n; k++) ((S[0] = x + this.r(-0.2, 0.2), S[1] = y + this.r(-0.2, 0.2), S[2] = gz + 1, S[3] = gz, S[4] = this.r(-0.2, 0.2), S[5] = this.r(-0.2, 0.2), S[6] = this.r(1, 2), S[7] = this.r(1, 1.6), S[8] = 6, S[9] = 18, S[10] = 0.35, S[11] = 0.8, S[12] = -0.3), this.pool.spawnS(Shape.Smoke, C.Steam, 0));
  }
  /** Level-up: tree-coloured ground ring, rising pillar and sparks around the player. */
  levelUp(x: number, y: number, gz: number, col: number): void {
    const p = this.pool;
    ((S[0] = x, S[1] = y, S[2] = gz + 0.05, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.8, S[8] = 10, S[9] = 90, S[10] = 0.9, S[11] = 0, S[12] = 0), p.spawnS(Shape.Ring, col, PF.Add | PF.Prio | PF.Flat));
    ((S[0] = x, S[1] = y, S[2] = gz, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 1.1, S[8] = 26, S[9] = 34, S[10] = 0.55, S[11] = 0, S[12] = 0), p.spawnS(Shape.Beam, col, PF.Add | PF.Prio));
    for (let k = 0, n = this.n(24); k < n; k++) { const a = this.r(0, TAU), rr = this.r(0.2, 0.8);
      const i = ((S[0] = x + Math.cos(a) * rr, S[1] = y + Math.sin(a) * rr, S[2] = gz + this.r(0, 1), S[3] = gz, S[4] = Math.cos(a) * 0.3, S[5] = Math.sin(a) * 0.3, S[6] = this.r(2, 5), S[7] = this.r(0.8, 1.6), S[8] = this.r(3, 7), S[9] = 1, S[10] = 1, S[11] = 0.6, S[12] = -0.5), p.spawnS(k % 3 ? Shape.Glow : Shape.Star, col, PF.Add | PF.Prio | PF.Blink)); if (i >= 0) p.vrot[i] = 2; }
    this.flash = Math.max(this.flash, 0.12); this.flashColor = col;
  }
  igniteBurst(x: number, y: number, gz: number): void {
    for (let k = 0, n = this.n(10); k < n; k++) { const a = this.r(0, TAU), v = this.r(0.5, 1.5);
      ((S[0] = x, S[1] = y, S[2] = gz + 0.5, S[3] = gz, S[4] = Math.cos(a) * v, S[5] = Math.sin(a) * v, S[6] = this.r(2, 4), S[7] = this.r(0.5, 1), S[8] = 2.5, S[9] = 1, S[10] = 1, S[11] = 1, S[12] = 2), this.pool.spawnS(Shape.Spark, C.Ember, PF.Add | PF.Stretch)); }
    ((S[0] = x, S[1] = y, S[2] = gz + 0.6, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.35, S[8] = 20, S[9] = 60, S[10] = 0.7, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Glow, C.Fire, PF.Add));
  }
  snuff(x: number, y: number, gz: number): void {
    for (let k = 0, n = this.n(6); k < n; k++) ((S[0] = x + this.r(-0.15, 0.15), S[1] = y + this.r(-0.15, 0.15), S[2] = gz + 0.6, S[3] = gz, S[4] = this.r(-0.2, 0.2), S[5] = this.r(-0.2, 0.2), S[6] = this.r(0.8, 1.6), S[7] = this.r(1.2, 2), S[8] = 6, S[9] = 20, S[10] = 0.5, S[11] = 0.6, S[12] = -0.3), this.pool.spawnS(Shape.Smoke, C.Smoke, 0));
  }

  // ---------------------------------------------------------------- continuous emitters (call with per-frame dt)
  private chance(rate: number, dt: number): boolean { return this.rnd() < rate * dt * this.density; }
  fireEmit(x: number, y: number, gz: number, big: boolean, dt: number): void {
    const p = this.pool;
    if (this.chance(big ? 9 : 3, dt)) { const a = this.r(0, TAU);
      ((S[0] = x + this.r(-0.15, 0.15), S[1] = y + this.r(-0.15, 0.15), S[2] = gz + (big ? 0.6 : 2.2), S[3] = gz, S[4] = Math.cos(a) * 0.3, S[5] = Math.sin(a) * 0.3, S[6] = this.r(1.5, 3.5), S[7] = this.r(0.9, 1.8), S[8] = 2.2, S[9] = 1, S[10] = 1, S[11] = 0.4, S[12] = -0.4), p.spawnS(Shape.Spark, C.Ember, PF.Add | PF.Stretch | PF.Blink)); }
    if (big && this.chance(1.6, dt)) ((S[0] = x, S[1] = y, S[2] = gz + 1.6, S[3] = gz, S[4] = this.r(-0.1, 0.1), S[5] = this.r(-0.1, 0.1), S[6] = this.r(0.9, 1.4), S[7] = this.r(1.8, 2.8), S[8] = 8, S[9] = 26, S[10] = 0.22, S[11] = 0.4, S[12] = -0.2), p.spawnS(Shape.Smoke, C.Smoke, 0));
  }
  exhaust(x: number, y: number, gz: number, heading: number, load: number, dt: number): void {
    if (!this.chance(5 + 12 * load, dt)) return; const bx = x - Math.cos(heading) * 1.1, by = y - Math.sin(heading) * 1.1;
    ((S[0] = bx, S[1] = by, S[2] = gz + 0.4, S[3] = gz, S[4] = -Math.cos(heading) * 0.6 + this.r(-0.15, 0.15), S[5] = -Math.sin(heading) * 0.6 + this.r(-0.15, 0.15), S[6] = this.r(0.3, 0.7), S[7] = this.r(0.7, 1.3), S[8] = 5, S[9] = 16 + 8 * load, S[10] = 0.3 + 0.15 * load, S[11] = 1.4, S[12] = -0.3), this.pool.spawnS(Shape.Smoke, C.Exhaust, 0));
  }
  wheelDust(x: number, y: number, gz: number, heading: number, speed: number, col: number, dt: number): void {
    if (!this.chance(Math.min(18, speed * 1.4), dt)) return; const s = this.rnd() < 0.5 ? -1 : 1, bx = x - Math.cos(heading) * 0.9 - Math.sin(heading) * 0.45 * s, by = y - Math.sin(heading) * 0.9 + Math.cos(heading) * 0.45 * s;
    ((S[0] = bx, S[1] = by, S[2] = gz + 0.15, S[3] = gz, S[4] = -Math.cos(heading) * this.r(0.2, 0.8), S[5] = -Math.sin(heading) * this.r(0.2, 0.8), S[6] = this.r(0.2, 0.6), S[7] = this.r(0.6, 1.1), S[8] = 7, S[9] = 22, S[10] = 0.35, S[11] = 1.6, S[12] = -0.1), this.pool.spawnS(Shape.Smoke, col, 0));
  }
  firefly(x: number, y: number, gz: number): void {
    const i = ((S[0] = x, S[1] = y, S[2] = gz + this.r(0.6, 2.4), S[3] = gz, S[4] = this.r(-0.25, 0.25), S[5] = this.r(-0.25, 0.25), S[6] = this.r(-0.1, 0.1), S[7] = this.r(4, 8), S[8] = this.r(5, 8), S[9] = 5, S[10] = 0.9, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Glow, C.Firefly, PF.Add | PF.Ambient | PF.Blink | PF.FadeIn));
    if (i >= 0) this.pool.vrot[i] = this.r(1.5, 3.5);
  }
  mote(x: number, y: number, gz: number): void {
    ((S[0] = x, S[1] = y, S[2] = gz + this.r(0.5, 3.5), S[3] = gz, S[4] = this.r(-0.12, 0.12), S[5] = this.r(-0.12, 0.12), S[6] = this.r(-0.05, 0.08), S[7] = this.r(5, 9), S[8] = this.r(2, 3.5), S[9] = 2, S[10] = 0.4, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Glow, C.Mote, PF.Add | PF.Ambient | PF.FadeIn));
  }
  leaf(x: number, y: number, gz: number, windDir: number, wind: number, autumn: boolean): void {
    const v = 0.8 + wind * 0.25, i = ((S[0] = x, S[1] = y, S[2] = gz + this.r(2.5, 5), S[3] = gz, S[4] = Math.cos(windDir) * v + this.r(-0.3, 0.3), S[5] = Math.sin(windDir) * v + this.r(-0.3, 0.3), S[6] = this.r(-0.4, 0.2), S[7] = this.r(3, 5), S[8] = 4, S[9] = 4, S[10] = 0.95, S[11] = 0, S[12] = 0.35), this.pool.spawnS(Shape.Leaf, autumn ? C.Autumn : C.Leaf, PF.Ambient | PF.FadeIn));
    if (i >= 0) this.pool.vrot[i] = this.r(-4, 4);
  }
  rainSplash(x: number, y: number, gz: number, water: boolean): void {
    if (water) { this.ripple(x, y, gz, 0.35, true); return; }
    const i = ((S[0] = x, S[1] = y, S[2] = gz + 0.02, S[3] = gz, S[4] = 0, S[5] = 0, S[6] = 0, S[7] = 0.28, S[8] = 2, S[9] = 9, S[10] = 0.45, S[11] = 0, S[12] = 0), this.pool.spawnS(Shape.Ring, C.Water, PF.Flat | PF.Ambient));
    if (i >= 0 && this.rnd() < 0.5) ((S[0] = x, S[1] = y, S[2] = gz + 0.05, S[3] = gz, S[4] = this.r(-0.3, 0.3), S[5] = this.r(-0.3, 0.3), S[6] = this.r(2, 3.5), S[7] = 0.25, S[8] = 1.6, S[9] = 1, S[10] = 0.5, S[11] = 0, S[12] = 22), this.pool.spawnS(Shape.Drop, C.Water, PF.Ambient | PF.Stretch));
  }

  // ---------------------------------------------------------------- screen cues
  /** The local player took damage: frac = amount / max hp. cold/heat recolour the vignette for exposure damage. */
  damaged(frac: number, kind: "hit" | "cold" | "heat" | "fire" = "hit"): void {
    this.hurt = Math.min(1, this.hurt + 0.35 + frac * 3); this.hurtColor = kind === "cold" ? C.Cold : kind === "heat" || kind === "fire" ? C.Fire : C.Blood;
    if (kind === "hit" || kind === "fire") { this.shake(Math.min(0.5, 0.18 + frac * 2)); if (frac >= 0.12) this.hitStop(0.06); }
  }
  /** Horde / night start: light flicker, fog roll-in and a red dread vignette. */
  hordeCue(active: boolean): void { this.flickerLeft = 1.4; this.fogHold = active ? 9 : 6; this.fogPeak = active ? 0.55 : 0.4; this.dread = active ? 0.8 : 0.55; if (active) this.shake(0.2); }
  nightFall(): void { this.fogHold = 7; this.fogPeak = 0.3; }
}
