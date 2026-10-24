/**
 * VehicleView: client-side vehicle presentation. Takes plain snapshots of core's Vehicle/VehicleSeats/Hitch state
 * (render does not depend on @engine/gameplay; the client maps components -> VehicleSnapshot), smooths them per frame
 * (shortest-arc heading, exponential position, snap on teleport), and owns proxy entities in the view world:
 *  - one billboard Sprite per footprint segment (long vehicles are several depth-sorted segments; facing = heading so
 *    the 8-direction art row follows AssetRegistry.directionIndex), swapped to `_int` cutaway sprites while the local
 *    player is inside a camper,
 *  - headlight LightSources ahead of the heading (a cone of 3 growing circles; 1 on lowend) when the engine is on and
 *    it is dark.
 * Trailers (snapshot.parent != 0) are re-posed from the SMOOTHED tow's rear hitch with their own smoothed heading, so
 * the joint never separates between snapshots. Riders are returned as RiderPlacement (seat anchor, quantized facing,
 * depth-nudged behind the segment so the body crops the legs); the caller writes them to the rider entity's
 * Transform (no PrevTransform interpolation); gameplay sets the rider's AnimState to Sit (13, ADR-101).
 */
import { Transform, type Entity, type World } from "@engine/core";
import { LightSource, Occluder, Sprite, SpriteFlag } from "../components.js";
import type { AssetRegistry } from "@engine/assets";
import {
  PoseSmoother, RIDER_DK_CABIN, RIDER_DK_OPEN, dirAngle, hasInterior, headlightCone, insideFootprint, isPowered, quantizeDir8,
  seatAnchors, segmentCount, segmentU, toWorld, trailerPose, depthNudge, type VehicleRenderDef,
} from "./layout.js";
import { modelHeight } from "./model.js";
import { vehicleSpriteKey } from "./atlas.js";

export interface VehicleSnapshot {
  /** stable id (net id) */ key: number; def: VehicleRenderDef;
  x: number; y: number; z?: number; heading: number; drift?: number; speed?: number;
  /** VehicleSeats.occupant (rider keys, 0 = empty), index = seat */ occupants?: readonly number[];
  /** Hitch.parentNetId: the tow this trailer hangs on (0 = none) */ parent?: number;
  /** engine on (driver present / ignition); default: occupied seat 0 or |speed| >= 0.25 */ on?: boolean;
}
export interface VehicleViewOpts {
  /** 0 (day) .. 1 (night); headlights scale with it and are off below ~0.15 */ darkness: number;
  lowEnd?: boolean;
  /** rider key of the local player (cutaway when seated in an interior vehicle) */ localRider?: number;
  /** local player's world position (cutaway when standing inside a parked interior vehicle) */ localPos?: { x: number; y: number };
  /** drift yaw added to the drawn heading (fraction of Vehicle.drift) */ driftYaw?: number;
}
export interface VehicleSpatial { insert(e: Entity, x: number, y: number): void; remove(e: Entity): void }
export interface RiderPlacement { rider: number; vehicle: number; seat: number; x: number; y: number; z: number; facing: number; cropped: boolean }
export interface VehiclePose { x: number; y: number; z: number; heading: number; dir: number; interior: boolean }

interface Rec { smooth: PoseSmoother; segs: Entity[]; segIds: number[]; intIds: number[]; lights: Entity[]; def: VehicleRenderDef; pose: VehiclePose; seen: number }

export class VehicleView {
  readonly recs = new Map<number, Rec>();
  private frame = 0;
  private readonly iso: { tileH: number; zStep: number }; private readonly zf: number; private readonly spatial: VehicleSpatial | undefined;
  /** spatial: the renderer's chunked index when setSpatialIndex is used (proxies must be in it to be drawn). */
  constructor(private readonly world: World, private readonly registry: AssetRegistry, o: { iso?: { tileH: number; zStep: number }; zFactor?: number; spatial?: VehicleSpatial } = {}) {
    this.iso = o.iso ?? { tileH: 32, zStep: 16 }; this.zf = o.zFactor ?? 1 / 3; this.spatial = o.spatial;
  }

  pose(key: number): VehiclePose | undefined { return this.recs.get(key)?.pose; }

  sync(list: readonly VehicleSnapshot[], dt: number, o: VehicleViewOpts): RiderPlacement[] {
    const w = this.world; this.frame++; const out: RiderPlacement[] = [];
    const byKey = new Map(list.map((s) => [s.key, s]));
    // tows first so trailers read the smoothed tow pose (chains: trailer of trailer)
    const order = [...list].sort((a, b) => depthOf(a, byKey) - depthOf(b, byKey));
    for (const s of order) {
      let r = this.recs.get(s.key);
      if (!r || r.def !== s.def) { if (r) this.drop(r); r = this.create(s.def); this.recs.set(s.key, r); }
      r.seen = this.frame;
      const sm = r.smooth.update({ x: s.x, y: s.y, z: s.z ?? 0, heading: s.heading, drift: s.drift ?? 0 }, dt);
      let x = sm.x, y = sm.y, h = sm.heading + sm.drift * (o.driftYaw ?? 0);
      const tow = s.parent ? this.recs.get(s.parent) : undefined;
      if (tow && tow.seen === this.frame) { const p = trailerPose(tow.def, tow.pose.x, tow.pose.y, tow.pose.heading, s.def, sm.heading); if (p) { x = p.x; y = p.y; h = p.heading; } }
      const dir = quantizeDir8(h), hq = dirAngle(dir), z = sm.z;
      const occ = s.occupants ?? [];
      const inside = hasInterior(s.def) && ((o.localRider !== undefined && o.localRider !== 0 && occ.includes(o.localRider)) || (!!o.localPos && insideFootprint(s.def, x, y, h, o.localPos.x, o.localPos.y, -0.1)));
      r.pose = { x, y, z, heading: h, dir, interior: inside };
      // segments: positions on the QUANTIZED heading so the pieces line up with the art row
      const n = r.segs.length;
      for (let i = 0; i < n; i++) {
        const [sx, sy] = toWorld(x, y, hq, segmentU(s.def, i), 0); const e = r.segs[i]!;
        w.set(e, Transform, { x: sx, y: sy, z, facing: h }); this.spatial?.insert(e, sx, sy);
        const id = inside && r.intIds[i]! >= 0 ? r.intIds[i]! : r.segIds[i]!; const sp = w.get(e, Sprite);
        const fl = inside ? SpriteFlag.Footprint | SpriteFlag.Cutaway : SpriteFlag.Footprint; // cutaway: no height depth so the occupant stands on the floor
        if (sp && (sp.spriteId !== id || sp.flags !== fl)) w.set(e, Sprite, { ...sp, spriteId: id, flags: fl });
        if (w.has(e, Occluder) && inside) w.remove(e, Occluder);
        else if (!w.has(e, Occluder) && !inside && modelHeight(s.def) > 1.5) w.add(e, Occluder, { fade: 0.45 });
      }
      // headlights
      const on = isPowered(s.def) && (s.on ?? ((occ[0] ?? 0) !== 0 || Math.abs(s.speed ?? 0) >= 0.25));
      const k = on ? Math.min(1, Math.max(0, (o.darkness - 0.15) / 0.5)) : 0;
      const cone = k > 0 ? headlightCone(s.def, !!o.lowEnd) : [];
      while (r.lights.length > cone.length) { const e = r.lights.pop()!; this.spatial?.remove(e); w.destroy(e); }
      for (let i = 0; i < cone.length; i++) {
        const c = cone[i]!; let e = r.lights[i];
        if (e === undefined) { e = w.create(); w.add(e, Transform, { x, y, z: 0, facing: 0 }); w.add(e, LightSource, { r: 1, g: 0.93, b: 0.75, radius: c.radius, intensity: 0, flicker: 0 }); r.lights.push(e); }
        const [lx, ly] = toWorld(x, y, h, c.u, 0); w.set(e, Transform, { x: lx, y: ly, z: 0, facing: 0 });
        w.set(e, LightSource, { r: 1, g: 0.93, b: 0.75, radius: c.radius, intensity: c.intensity * k, flicker: 0 });
      }
      // riders
      const seats = seatAnchors(s.def);
      for (let i = 0; i < occ.length && i < seats.length; i++) {
        const rid = occ[i]!; if (!rid) continue; const a = seats[i]!;
        const [px, py] = toWorld(x, y, hq, a.u, a.v); const p = { x: px, y: py, z: z + a.z };
        // depth relative to the seat's segment centre
        const si = Math.min(n - 1, Math.max(0, Math.floor((s.def.footprint.length / 2 - a.u) / (s.def.footprint.length / n))));
        const [cx, cy] = toWorld(x, y, hq, segmentU(s.def, si), 0); const segKey = cx + cy + z * this.zf, key = p.x + p.y + p.z * this.zf;
        depthNudge(p, segKey + (a.cabin ? RIDER_DK_CABIN : RIDER_DK_OPEN) - key, this.iso, this.zf);
        out.push({ rider: rid, vehicle: s.key, seat: i, x: p.x, y: p.y, z: p.z, facing: hq, cropped: a.cabin });
      }
    }
    for (const [k, r] of this.recs) if (r.seen !== this.frame) { this.drop(r); this.recs.delete(k); }
    return out;
  }

  private sid(key: string): number { try { this.registry.byKey(key); return this.registry.id(key); } catch { return -1; } }
  private create(def: VehicleRenderDef): Rec {
    const w = this.world; const n = segmentCount(def); const segs: Entity[] = [], segIds: number[] = [], intIds: number[] = [];
    for (let i = 0; i < n; i++) {
      const id = this.sid(vehicleSpriteKey(def.id, i)); if (id < 0) continue;
      const e = w.create(); w.add(e, Transform, { x: 0, y: 0, z: 0, facing: 0 }); w.add(e, Sprite, { spriteId: id, frameId: 0, flags: SpriteFlag.Footprint, scale: 1, tint: 0 });
      segs.push(e); segIds.push(id); intIds.push(this.sid(vehicleSpriteKey(def.id, i, true)));
    }
    return { smooth: new PoseSmoother(), segs, segIds, intIds, lights: [], def, pose: { x: 0, y: 0, z: 0, heading: 0, dir: 0, interior: false }, seen: 0 };
  }
  private drop(r: Rec): void { for (const e of [...r.segs, ...r.lights]) { this.spatial?.remove(e); if (this.world.isAlive(e)) this.world.destroy(e); } r.segs = []; r.lights = []; }
  dispose(): void { for (const r of this.recs.values()) this.drop(r); this.recs.clear(); }
}
function depthOf(s: VehicleSnapshot, m: Map<number, VehicleSnapshot>): number { let d = 0, c = s; while (c.parent && d < 8) { const p = m.get(c.parent); if (!p) break; c = p; d++; } return d; }
