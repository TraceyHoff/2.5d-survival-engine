import { defineComponent, defineResource, entityIndex, Transform, type Entity, type World } from "@engine/core";
import { ChunkedSpatialIndex } from "./hierarchical.js";
import type { BuildingGrid } from "./building.js";

/** Falloff curves over normalized distance u = d / radius in [0,1]. */
export const enum Falloff { Constant = 0, Linear = 1, Quadratic = 2 }
/**
 * Generic field emitter (heat, light-as-warmth, smell, noise...). `kind` is a gameplay-defined u8.
 * Position comes from Transform. Networked so clients can sample the same field for prediction.
 */
export const Emitter = defineComponent("Emitter", { kind: "u8", radius: "f32", strength: "f32", falloff: "u8" }, { networked: true });

export const falloffAt = (falloff: number, u: number): number =>
  u >= 1 ? 0 : falloff === Falloff.Constant ? 1 : falloff === Falloff.Quadratic ? (1 - u) * (1 - u) : 1 - u;

export interface Point3 { x: number; y: number; z: number }
/** Multiplier in [0,1] applied to an emitter's contribution (1 = unoccluded). */
export type OcclusionFn = (kind: number, from: Point3, to: Point3) => number;
interface Rec { kind: number; x: number; y: number; z: number; radius: number; strength: number; falloff: number }
export interface EmitterHit { entity: Entity; distance: number; contribution: number }

export class EmitterIndex {
  private byKind = new Map<number, ChunkedSpatialIndex>();
  private recs = new Map<Entity, Rec>();
  private maxRadius = new Map<number, number>();
  occlusion: OcclusionFn | undefined;
  constructor(private world: World, opts: { occlusion?: OcclusionFn } = {}) { this.occlusion = opts.occlusion; }
  get size(): number { return this.recs.size; }
  private idx(kind: number): ChunkedSpatialIndex { let i = this.byKind.get(kind); if (!i) this.byKind.set(kind, (i = new ChunkedSpatialIndex())); return i; }
  private put(e: Entity): void {
    const w = this.world; const em = w.get(e, Emitter); const t = w.get(e, Transform);
    if (!em || !t) { this.drop(e); return; }
    const old = this.recs.get(e); if (old && old.kind !== em.kind) this.byKind.get(old.kind)?.remove(e);
    this.recs.set(e, { kind: em.kind, x: t.x, y: t.y, z: t.z, radius: em.radius, strength: em.strength, falloff: em.falloff });
    this.idx(em.kind).insert(e, t.x, t.y);
    if (em.radius > (this.maxRadius.get(em.kind) ?? 0)) this.maxRadius.set(em.kind, em.radius);
  }
  private drop(e: Entity): void { const r = this.recs.get(e); if (r) { this.byKind.get(r.kind)?.remove(e); this.recs.delete(e); } }
  /** Incremental update from Emitter/Transform change + removal records (postSim). */
  update(): void {
    const w = this.world;
    for (const e of w.removed(Emitter)) this.drop(e);
    for (const e of w.removed(Transform)) if (this.recs.has(e)) this.drop(e);
    for (const e of w.changed(Emitter)) this.put(e);
    const em = w.store(Emitter);
    for (const e of w.changed(Transform)) if (em.has(entityIndex(e))) this.put(e);
  }
  rebuild(): void { this.byKind.clear(); this.recs.clear(); this.maxRadius.clear(); for (const e of this.world.query([Emitter, Transform])) this.put(e); }
  private contribution(r: Rec, x: number, y: number, z: number | undefined): { d: number; c: number } {
    const dz = z === undefined ? 0 : z - r.z; const d = Math.sqrt((r.x - x) ** 2 + (r.y - y) ** 2 + dz * dz);
    let c = r.strength * falloffAt(r.falloff, r.radius > 0 ? d / r.radius : 1);
    if (c !== 0 && this.occlusion) c *= this.occlusion(r.kind, r, { x, y, z: z ?? r.z });
    return { d, c };
  }
  private scratch: Entity[] = [];
  /** Summed contribution of all emitters of `kind` at (x, y[, z]). */
  sampleField(kind: number, x: number, y: number, z?: number): number {
    const ix = this.byKind.get(kind); if (!ix) return 0; const R = this.maxRadius.get(kind) ?? 0;
    const cand = this.scratch; cand.length = 0; ix.queryRadius(x, y, R, cand);
    let sum = 0; for (const e of cand) sum += this.contribution(this.recs.get(e)!, x, y, z).c;
    return sum;
  }
  /** Up to n emitters of `kind` with non-zero contribution at (x,y), nearest first. */
  nearestEmitters(kind: number, x: number, y: number, n: number, z?: number): EmitterHit[] {
    const ix = this.byKind.get(kind); if (!ix || n <= 0) return []; const R = this.maxRadius.get(kind) ?? 0;
    const out: EmitterHit[] = [];
    for (const e of ix.queryRadius(x, y, R)) { const { d, c } = this.contribution(this.recs.get(e)!, x, y, z); if (c !== 0) out.push({ entity: e, distance: d, contribution: c }); }
    return out.sort((a, b) => a.distance - b.distance || a.entity - b.entity).slice(0, n);
  }
}
export const EmitterIndexRes = defineResource<EmitterIndex>("EmitterIndex");

/** Registers Emitter, the EmitterIndex resource and postSim system "emitterIndex". Idempotent. */
export function installEmitterIndex(world: World, opts: { occlusion?: OcclusionFn } = {}): EmitterIndex {
  const ex = world.getResource(EmitterIndexRes); if (ex) return ex;
  world.register(Emitter);
  const ix = new EmitterIndex(world, opts); ix.rebuild(); world.setResource(EmitterIndexRes, ix);
  world.addSystem("postSim", "emitterIndex", () => ix.update());
  return ix;
}

/**
 * Occlusion via BuildingGrid: walks tiles on the segment (excluding both endpoint tiles) at level floor(z);
 * each solid tile multiplies by `transmit` (default 0 = fully blocked). Restrict to some kinds with `kinds`.
 */
export function buildingOcclusion(grid: BuildingGrid, opts: { transmit?: number; kinds?: readonly number[] } = {}): OcclusionFn {
  const transmit = opts.transmit ?? 0; const kinds = opts.kinds ? new Set(opts.kinds) : undefined;
  return (kind, a, b) => {
    if (kinds && !kinds.has(kind)) return 1;
    const z = Math.max(0, Math.floor(b.z)); let f = 1;
    const x0 = Math.floor(a.x), y0 = Math.floor(a.y), x1 = Math.floor(b.x), y1 = Math.floor(b.y);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); let px = x0, py = y0;
    for (let i = 1; i < steps; i++) {
      const tx = Math.floor(a.x + ((b.x - a.x) * i) / steps), ty = Math.floor(a.y + ((b.y - a.y) * i) / steps);
      if ((tx === px && ty === py) || (tx === x0 && ty === y0) || (tx === x1 && ty === y1)) continue; px = tx; py = ty;
      if (grid.isBlocked(tx, ty, z)) { f *= transmit; if (f === 0) return 0; }
    }
    return f;
  };
}
