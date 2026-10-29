/**
 * ADR-214: turns the replicated world + the audio director's per-frame events (ADR-117) into effects. Every damage the
 * sim applies is drawn at the victim (HitReact: impact by cause and target, tracer from a ranged / turret source; Dead:
 * death burst; turret kills without a HitReact get a tracer from the nearest turret), so nothing is hurt "by nothing".
 * Read-only on the world; per-frame maps are reused (no growth beyond the entity count).
 */
import { Transform, NetId, type World, type Entity } from "@engine/core";
import { Health, HitReact, Dead, Zombie, Animal, BuildPiece, Vehicle, Progression, HordeStatus, hitDirRad } from "@engine/gameplay";
import type { EntSnap, SoundEvent } from "../audio/events.js";
import type { WorldAudioState } from "../audio/snapshot.js";
import { Fx, CHEST, type ImpactMat, type Surface } from "./effects.js";
import { C, treeColor } from "./palette.js";

// DamageCause (const enum in @engine/gameplay; literals here so isolated transpilers agree)
const DC = { Hypothermia: 3, Hyperthermia: 4, Combat: 5, Sunlight: 6, Fire: 7, Contact: 8, Explosion: 9, Turret: 10, Trap: 11 } as const;
const RANGED = new Set(["bow", "crossbow", "sling", "pistol", "rifle", "autorifle", "shotgun", "musket"]);
const ANIM_RUN = 2, ANIM_SWIM = 14;
export interface FxView { x0: number; y0: number; x1: number; y1: number }
export interface FxWeather { kind: number; intensity: number; windDir: number; windSpeed: number }
export interface FxFrame {
  world: World; local: Entity | undefined; snap: WorldAudioState | undefined; events: readonly SoundEvent[];
  /** real seconds since the last frame */ dt: number; daylight: number; sunElev: number; indoors: boolean;
  ground: (x: number, y: number, z: number) => number; tile: (x: number, y: number) => number;
  view: FxView; weather: FxWeather; ambient: boolean;
}
export const surfaceOfTile = (t: number): Surface => (t === 1 || t === 8 ? "water" : t === 2 ? "sand" : t === 5 ? "stone" : t === 6 ? "dirt" : t === 7 ? "snow" : "grass");
const BIG_FIRE = /campfire|bonfire|fire_?pit|brazier|hearth|fireplace/;
const SMALL_FIRE = /torch|candle|furnace|forge|kiln|smelter|stove|oven|grill/;

export class FxDirector {
  private hits = new Map<Entity, number>(); private deaths = new Map<Entity, number>();
  private byNet = new Map<number, Entity>(); private netStamp = -1000; private wakes = new Map<number, number>();
  private settled = 0; private frame = 0; private hp = -1; private hpMax = 1; private lastHitTick = -1;
  private tl = new Int32Array(8).fill(-1); private lvl = -1; private hPhase = -1; private hSeq = -1; private daylightPrev = -1;
  /** Reused scratch (no per-frame allocation): Transform read-out, Map prune target, ambient spawn kind. */
  private readonly tf = { x: 0, y: 0, z: 0 }; private pw: World | undefined; private pc: typeof HitReact | typeof Dead = HitReact;
  private readonly prune = (_v: number, e: Entity, m: Map<Entity, number>): void => { const w = this.pw!; if (!w.isAlive(e) || !w.has(e, this.pc)) m.delete(e); };
  private readonly sfx = new Map<string, string>();
  /** Lit fires seen this frame (x, y, z, big) for the Canvas2D flicker glow. */
  readonly glows = new Float32Array(32 * 4); glowCount = 0;
  constructor(readonly fx: Fx) {}
  reset(): void { this.hits.clear(); this.deaths.clear(); this.byNet.clear(); this.netStamp = -1000; this.wakes.clear(); this.settled = 0; this.hp = -1; this.tl.fill(-1); this.lvl = -1; this.hPhase = -1; this.hSeq = -1; this.daylightPrev = -1; }

  step(f: FxFrame): void {
    const w = f.world, fx = this.fx; this.frame++;
    const live = this.settled > 20; // first frames seed state without bursting (join / respawn / chunk load)
    this.scanHits(w, f, live); this.scanDeaths(w, f, live); this.scanLocal(w, f, live);
    if (live) { const evs = f.events; for (let i = 0; i < evs.length; i++) this.onEvent(evs[i]!, f); }
    this.continuous(f);
    if (f.ambient && !f.indoors) this.ambient(f);
    else fx.raysTarget = 0;
    this.settled++;
  }

  private z(f: FxFrame, x: number, y: number, z: number): number { return f.ground(x, y, z); }
  private srcEntity(w: World, net: number): Entity | undefined {
    if (!net) return undefined; let e = this.byNet.get(net);
    if ((e === undefined || !w.isAlive(e)) && (this.frame - this.netStamp >= 30 || this.frame < this.netStamp)) { this.netStamp = this.frame; this.byNet.clear(); const st = w.store(NetId); for (let k = 0; k < st.size; k++) { const x = st.dense[k]! as Entity; const id = w.getField(x, NetId, "id"); if (id) this.byNet.set(id, x); } e = this.byNet.get(net); }
    return e;
  }
  private targetMat(w: World, e: Entity): ImpactMat { return w.has(e, Zombie) ? "ichor" : w.has(e, BuildPiece) ? "wood" : w.has(e, Animal) ? "fur" : "blood"; }
  private nearestTurret(x: number, y: number, f: FxFrame): EntSnap | undefined {
    let best: EntSnap | undefined, bd = 14 * 14; if (!f.snap) return undefined;
    const es = f.snap.ents; for (let i = 0; i < es.length; i++) { const e = es[i]!; if (e.kind === "piece" && e.ready !== undefined && (this.subKind(e.sub) & 4)) { const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; best = e; } } }
    return best;
  }
  /** Bit flags per piece sub id (1 big fire, 2 small fire, 4 turret), cached per distinct id (bounded by the asset set). */
  private subKind(sub: string): number {
    let k = this.subK.get(sub); if (k !== undefined) return k;
    k = (BIG_FIRE.test(sub) ? 1 : SMALL_FIRE.test(sub) ? 2 : 0) | (/turret|gun|ballista|tower/.test(sub) ? 4 : 0); if (this.subK.size < 1024) this.subK.set(sub, k); return k;
  }
  private readonly subK = new Map<string, number>();
  private scanHits(w: World, f: FxFrame, live: boolean): void {
    if (!w.isRegistered(HitReact)) return; const fx = this.fx;
    const hs = w.store(HitReact);
    for (let k = hs.size - 1; k >= 0; k--) {
      const e = hs.dense[k]! as Entity; if (!w.has(e, Transform)) continue;
      const st = w.getField(e, HitReact, "startTick") ?? 0; const prev = this.hits.get(e); if (prev === st) continue; this.hits.set(e, st);
      if (!live || prev === undefined && st + 10 < w.tick) continue;
      const t = w.getInto(e, Transform, this.tf)!; const gz = this.z(f, t.x, t.y, t.z);
      const cause = w.getField(e, HitReact, "cause") ?? DC.Combat, amount = w.getField(e, HitReact, "amount") ?? 1, src = w.getField(e, HitReact, "src") ?? 0;
      const max = w.getField(e, Health, "max") ?? 100, heavy = amount >= Math.max(25, max * 0.3);
      const dir = src ? hitDirRad(w.getField(e, HitReact, "dir") ?? 0) : NaN; const power = Math.min(2.5, 0.5 + amount / 18);
      let mat: ImpactMat = this.targetMat(w, e);
      if (cause === DC.Sunlight) mat = "sizzle"; else if (cause === DC.Fire) mat = "fire"; else if (cause === DC.Hypothermia || cause === DC.Hyperthermia) continue;
      fx.impact(t.x, t.y, gz, dir, mat, power, heavy);
      if (cause === DC.Explosion) fx.impact(t.x, t.y, gz, dir, "soot", power, false);
      if (cause === DC.Turret || cause === DC.Trap) fx.impact(t.x, t.y, gz, dir, "spark", 0.6, false);
      // visible attribution: ranged shooter / turret -> tracer
      const se = this.srcEntity(w, src); const s = se !== undefined ? this.snapOf(f, se as unknown as number) : undefined;
      const tz = gz + CHEST;
      if (s && ((s.kind === "player" && RANGED.has(s.sub)) || (s.kind === "piece" && s.ready !== undefined))) {
        const sz = this.z(f, s.x, s.y, s.z) + (s.kind === "piece" ? 1.2 : CHEST); fx.tracer(s.x, s.y, sz, t.x, t.y, tz, s.sub !== "bow" && s.sub !== "crossbow" && s.sub !== "sling");
      } else if (cause === DC.Turret && !s) { const tu = this.nearestTurret(t.x, t.y, f); if (tu) fx.tracer(tu.x, tu.y, this.z(f, tu.x, tu.y, tu.z) + 1.2, t.x, t.y, tz, true); }
      if (src && f.local !== undefined && se === f.local && e !== f.local) { fx.hitStop(heavy ? 0.07 : 0.035); fx.shake(heavy ? 0.22 : 0.08); }
      if (e === f.local) this.lastHitTick = st;
    }
    if (this.frame % 120 === 0) { this.pw = w; this.pc = HitReact; this.hits.forEach(this.prune); }
  }
  private scanDeaths(w: World, f: FxFrame, live: boolean): void {
    if (!w.isRegistered(Dead)) return; const fx = this.fx;
    const ds = w.store(Dead);
    for (let k = ds.size - 1; k >= 0; k--) {
      const e = ds.dense[k]! as Entity; if (!w.has(e, Transform)) continue;
      const tick = w.getField(e, Dead, "tick") ?? 0; if (this.deaths.get(e) === tick) continue; const seen = this.deaths.has(e); this.deaths.set(e, tick);
      if (!live || seen || tick + 40 < w.tick && tick !== 0) continue;
      const t = w.getInto(e, Transform, this.tf)!; const gz = this.z(f, t.x, t.y, t.z); const cause = w.getField(e, Dead, "cause") ?? DC.Combat;
      const mat: ImpactMat = cause === DC.Sunlight ? "sizzle" : cause === DC.Fire ? "fire" : this.targetMat(w, e);
      fx.death(t.x, t.y, gz, mat); fx.crit(t.x, t.y, gz);
      if (cause === DC.Explosion) fx.impact(t.x, t.y, gz, NaN, "soot", 2, false);
      if (cause === DC.Turret) { const tu = this.nearestTurret(t.x, t.y, f); if (tu) fx.tracer(tu.x, tu.y, this.z(f, tu.x, tu.y, tu.z) + 1.2, t.x, t.y, gz + CHEST, true); fx.impact(t.x, t.y, gz, NaN, "spark", 1, false); }
      if (cause === DC.Trap) fx.impact(t.x, t.y, gz, NaN, "spark", 1, false);
      if (e === f.local) { fx.damaged(0.5); fx.flash = Math.max(fx.flash, 0.2); fx.flashColor = C.Blood; }
    }
    if (this.frame % 120 === 60) { this.pw = w; this.pc = Dead; this.deaths.forEach(this.prune); }
  }
  private scanLocal(w: World, f: FxFrame, live: boolean): void {
    const fx = this.fx, me = f.local;
    if (me === undefined || !w.isAlive(me)) { fx.lowHp = 0; this.hp = -1; return; }
    const hp = w.getField(me, Health, "hp"), max = w.getField(me, Health, "max") ?? 100;
    if (hp !== undefined) {
      if (this.hp >= 0 && live && hp < this.hp - 1e-3 && !w.has(me, Dead)) {
        const frac = (this.hp - hp) / Math.max(1, max); const st = w.getField(me, HitReact, "startTick");
        const cause = st !== undefined && st === this.lastHitTick ? w.getField(me, HitReact, "cause") ?? DC.Combat : -1;
        if (cause === DC.Hypothermia) fx.damaged(frac, "cold"); else if (cause === DC.Hyperthermia) fx.damaged(frac, "heat"); else if (cause === DC.Fire || cause === DC.Sunlight) fx.damaged(frac, "fire");
        else if (cause >= 0 || frac >= 0.03) fx.damaged(frac);
      }
      this.hp = hp; this.hpMax = max;
      const k = hp / Math.max(1, max); fx.lowHp = !w.has(me, Dead) && k < 0.3 ? 0.25 + (0.3 - k) / 0.3 * 0.75 : 0;
    }
    if (this.frame % 6 !== 0) return;
    // level-up per skill tree (ADR-209 tlevel) -> tree-coloured burst; overall level only -> gold
    if (w.isRegistered(Progression) && w.has(me, Progression)) {
      let burst = -1; const level = w.getField(me, Progression, "level") ?? 0;
      for (let i = 0; i < 8; i++) { const v = w.getElement(me, Progression, "tlevel", i) ?? 0; if (this.tl[i]! >= 0 && v > this.tl[i]! && live) burst = i; this.tl[i] = v; }
      const lvUp = this.lvl >= 0 && level > this.lvl && live; this.lvl = level;
      if ((burst >= 0 || lvUp) && w.getInto(me, Transform, this.tf)) { const t = this.tf; fx.levelUp(t.x, t.y, this.z(f, t.x, t.y, t.z), burst >= 0 ? treeColor(burst) : C.TreeBase + 4); }
    }
    // horde warning / start -> flicker + fog roll-in + dread
    if (w.isRegistered(HordeStatus) && w.has(w.environment, HordeStatus)) {
      const env = w.environment, phase = w.getField(env, HordeStatus, "phase") ?? 0, seq = w.getField(env, HordeStatus, "seq") ?? 0, pp = this.hPhase, ps = this.hSeq; this.hPhase = phase; this.hSeq = seq;
      if (pp >= 0 && live) { if (phase === 1 && (pp !== 1 || ps !== seq)) fx.hordeCue(false); else if (phase === 2 && pp !== 2) fx.hordeCue(true); }
    }
    if (this.daylightPrev >= 0 && live && this.daylightPrev > 0.25 && f.daylight <= 0.25 && !f.indoors) fx.nightFall();
    this.daylightPrev = f.daylight;
  }

  private onEvent(ev: SoundEvent, f: FxFrame): void {
    const fx = this.fx, k = ev.key, pos = ev.pos; if (!pos) return;
    const s = ev.src !== undefined ? this.snapOf(f, ev.src) : undefined; const w = f.world;
    const x = pos.x, y = pos.y, gz = this.z(f, x, y, s?.z ?? 0);
    if (k.startsWith("footstep.")) {
      const kind = this.tail(k, 9); if (kind === "swim") { fx.wake(x, y, gz, this.facing(w, s)); return; }
      const surf: Surface = kind === "zombie" || kind === "animal" ? surfaceOfTile(f.tile(Math.floor(x), Math.floor(y))) : (kind as Surface);
      fx.footstep(x, y, gz, surf, s?.anim === ANIM_RUN || kind === "zombie", this.facing(w, s)); return;
    }
    if (k.startsWith("combat.swing.")) { fx.swing(x, y, gz, this.facing(w, s), this.tail(k, 13)); return; }
    if (k.startsWith("zombie.") && k.endsWith(".attack")) { fx.swing(x, y, gz, this.facing(w, s), "claw", true); return; }
    if (k === "animal.attack") { fx.swing(x, y, gz, this.facing(w, s), "fists", true); return; }
    if (k.startsWith("weapon.fire.")) { fx.muzzle(x, y, gz, this.facing(w, s), this.tail(k, 12)); return; }
    if (k === "combat.hit.structure") { fx.structureHit(x, y, gz + 1, s?.material ?? "wood"); return; }
    if (k.startsWith("gather.")) {
      const kind = this.tail(k, 7);
      if (kind === "tree_fall") { fx.treeFall(x, y, gz, false); return; }
      if (kind === "rock_break") { fx.rockBreak(x, y, gz); return; }
      const node = this.nearestNode(f, x, y); if (node) fx.gather(node.x, node.y, this.z(f, node.x, node.y, node.z), kind, Math.atan2(node.y - y, node.x - x));
      return;
    }
    if (k.startsWith("build.place.")) { fx.buildPlace(x, y, gz, this.tail(k, 12)); return; }
    if (k.startsWith("build.break.")) { fx.buildBreak(x, y, gz, this.tail(k, 12)); return; }
    if (k === "explosion" || k === "explosion.fire") { fx.explosion(x, y, gz, k === "explosion.fire"); return; }
    if (k === "craft.complete") { fx.sparkle(x, y, gz, C.TreeBase + 4, true); return; }
    if (k === "cook.complete") { fx.steam(x, y, gz); fx.sparkle(x, y, gz, C.Spark); return; }
    if (k === "fire.ignite") { if ((ev.gain ?? 1) >= 0.5) fx.igniteBurst(x, y, gz); return; }
    if (k === "fire.extinguish" || k === "fire.snuffed") { fx.snuff(x, y, gz); return; }
    if (k.startsWith("turret.fire") || k.startsWith("trap.")) { fx.impact(x, y, gz - CHEST + 0.8, NaN, "spark", 0.5, false); return; }
    if (k === "item.pickup") { fx.sparkle(x, y, gz, C.White); return; }
    if (k === "farm.water") { fx.splash(x, y, gz, 0.4); return; }
    if (k === "vehicle.engine.start") { for (let i = 0; i < 6; i++) fx.exhaust(x, y, gz, s ? w.getField(s.id as unknown as Entity, Vehicle, "heading") ?? 0 : 0, 1, 1); return; }
  }
  private facing(w: World, s: EntSnap | undefined): number { return s ? w.getField(s.id as unknown as Entity, Transform, "facing") ?? 0 : 0; }
  /** Event-key suffix, interned once per distinct key (keys are a fixed bank) so hot events never slice a new string. */
  private tail(k: string, n: number): string { let t = this.sfx.get(k); if (t === undefined) { t = k.slice(n); if (this.sfx.size < 512) this.sfx.set(k, t); } return t; }
  /** Snapshot entry by entity id: a linear scan (only on hits/events) instead of a per-frame rebuilt Map. */
  private snapOf(f: FxFrame, id: number): EntSnap | undefined { if (!f.snap) return undefined; const es = f.snap.ents; for (let i = 0; i < es.length; i++) if (es[i]!.id === id) return es[i]; return undefined; }
  private nearestNode(f: FxFrame, x: number, y: number): EntSnap | undefined {
    let best: EntSnap | undefined, bd = 2.6 * 2.6; if (!f.snap) return undefined; const es = f.snap.ents;
    for (let i = 0; i < es.length; i++) { const e = es[i]!; if (e.kind === "node") { const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; best = e; } } }
    return best;
  }
  private continuous(f: FxFrame): void {
    const fx = this.fx, w = f.world, dt = f.dt; this.glowCount = 0; if (!f.snap) return;
    const es = f.snap.ents;
    for (let i = 0; i < es.length; i++) { const e = es[i]!;
      if (e.lit && (e.kind === "piece" || e.kind === "fire")) {
        const sk = e.kind === "fire" ? 1 : this.subKind(e.sub), big = (sk & 1) !== 0, small = !big && (sk & 2) !== 0; if (!big && !small) continue;
        const gz = this.z(f, e.x, e.y, e.z); fx.fireEmit(e.x, e.y, gz, big, dt);
        if (this.glowCount < 32) { const o = this.glowCount++ * 4; this.glows[o] = e.x; this.glows[o + 1] = e.y; this.glows[o + 2] = gz + (big ? 0.6 : 2.2); this.glows[o + 3] = big ? 1 : 0.5; }
      } else if (e.kind === "vehicle" && e.vehicle && e.sub !== "bicycle" && e.sub !== "trailer") {
        const v = e.vehicle, gz = this.z(f, e.x, e.y, e.z), hd = w.getField(e.id as unknown as Entity, Vehicle, "heading") ?? 0, sp = Math.abs(v.speed);
        if (v.engineOn) fx.exhaust(e.x, e.y, gz, hd, Math.min(1, sp / Math.max(1, v.maxSpeed)), dt);
        if (sp > 1.5) { const t = f.tile(Math.floor(e.x), Math.floor(e.y)); if (t !== 1 && t !== 8 && t !== 5) fx.wheelDust(e.x, e.y, gz, hd, sp, t === 2 ? C.Sand : t === 7 ? C.White : C.Dust, dt); }
      } else if (e.anim === ANIM_SWIM && !e.dead) {
        const last = this.wakes.get(e.id) ?? -1, now = fx.time; if (now - last < 0.45) continue; const p = this.prevPos(e); this.wakes.set(e.id, now);
        if (p) fx.ripple(e.x, e.y, this.z(f, e.x, e.y, e.z), 0.5);
      }
    }
    if (this.wakes.size > 64) this.wakes.clear();
  }
  private prevPos(e: EntSnap): boolean { return e.kind === "player" || e.kind === "animal" || e.kind === "zombie"; }
  /** Ambient spawns, closure-free: kind 0 firefly, 1 dust mote, 2 rain splash, 3 wind leaf. */
  private ambient(f: FxFrame): void {
    const fx = this.fx, wx = f.weather, d = f.daylight;
    const rain = wx.kind === 1 || wx.kind === 2 ? Math.max(0.2, wx.intensity) : 0, clear = wx.kind === 0;
    const se = f.sunElev; fx.raysTarget = clear && se > 2 && se < 40 ? Math.min(1, (se - 2) / 6) * Math.min(1, (40 - se) / 15) : 0; // low sun only
    if (d < 0.3 && (clear || wx.kind === 4)) this.spawnIn(f, 5 * (1 - d / 0.3), 0);
    if (d > 0.45 && clear && f.snap?.listener) this.spawnIn(f, 2.5, 1);
    if (rain > 0) this.spawnIn(f, (wx.kind === 2 ? 70 : 40) * rain, 2);
    if (wx.windSpeed > 3 && wx.kind !== 3) this.spawnIn(f, Math.min(6, (wx.windSpeed - 3) * 0.6), 3);
  }
  private spawnIn(f: FxFrame, rate: number, kind: number): void {
    const fx = this.fx, v = f.view, wx = f.weather; let n = rate * f.dt * fx.density;
    while (n > 0) {
      if (n < 1 && fx.rnd() > n) break; n -= 1;
      const x = v.x0 + (v.x1 - v.x0) * fx.rnd(), y = v.y0 + (v.y1 - v.y0) * fx.rnd(), t = f.tile(Math.floor(x), Math.floor(y));
      if (kind === 0) { if (t === 3 || t === 4) fx.firefly(x, y, f.ground(x, y, 0)); }
      else if (kind === 1) { const c = f.snap!.listener; const mx = c.x + (x - (v.x0 + v.x1) / 2) * 0.4, my = c.y + (y - (v.y0 + v.y1) / 2) * 0.4; fx.mote(mx, my, f.ground(mx, my, 0)); }
      else if (kind === 2) { if (t !== 0) fx.rainSplash(x, y, f.ground(x, y, 0), t === 1 || t === 8); }
      else if (t === 3 || t === 4) fx.leaf(x, y, f.ground(x, y, 0), wx.windDir, wx.windSpeed, fx.rnd() < 0.3);
    }

  }
}
