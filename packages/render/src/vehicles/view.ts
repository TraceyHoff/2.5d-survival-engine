/**
 * VehicleView: client-side vehicle presentation. Takes plain snapshots of core's Vehicle/VehicleSeats/Hitch state
 * (render does not depend on @engine/gameplay; the client maps components -> VehicleSnapshot), smooths them per frame
 * (shortest-arc heading, exponential position, snap on teleport), and owns proxy entities in the view world:
 *  - one billboard Sprite per footprint segment (long vehicles are several depth-sorted segments; facing = heading so
 *    the 8-direction art row follows AssetRegistry.directionIndex), swapped to `_int` cutaway sprites while the local
 *    player is inside a camper,
 *  - headlight LightSources ahead of the heading (a cone of 3 growing circles; 1 on lowend) when the engine is on and
 *    it is dark.
 * Trailers (snapshot.parent != 0) are re-posed from the SMOOTHED tow's rear hitch with their own smoothed BROADCAST
 * heading (core Vehicle.heading of the trailer, ADR-101; no client articulation solve), so
 * the joint never separates between snapshots. Riders are returned as RiderPlacement (seat anchor, quantized facing,
 * depth-nudged behind the segment so the body crops the legs); the caller writes them to the rider entity's
 * Transform (no PrevTransform interpolation); gameplay sets the rider's AnimState to Sit (13, ADR-101).
 */
import { Transform, type Entity, type World } from "@engine/core";
import { LightSource, Occluder, Shadow, Sprite, SpriteFlag } from "../components.js";
import type { AssetRegistry } from "@engine/assets";
import {
  PoseSmoother, RIDER_DK_CABIN, RIDER_DK_OPEN, dirAngle, hasInterior, headlightCone, insideFootprint, isPowered, quantizeDir8,
  seatAnchors, segmentCount, segmentU, toWorld, trailerPose, depthNudge, type VehicleRenderDef,
} from "./layout.js";
import { modelHeight, modelZScale } from "./model.js";
import type { InteriorRegion } from "./interiorPass.js";
import { ART_INTERIOR, resolveVehicleArt, type VehicleArtBinding, type VehicleArtTable } from "./artPack.js";
import { PLAYER_HEIGHT_Z } from "./scale.js";
import { vehicleSpriteKey } from "./atlas.js";

export interface VehicleSnapshot {
  /** stable id (net id) */ key: number; def: VehicleRenderDef;
  x: number; y: number; z?: number; heading: number; drift?: number; speed?: number;
  /** VehicleSeats.occupant (rider keys, 0 = empty), index = seat */ occupants?: readonly number[];
  /** Hitch.parentNetId: the tow this trailer hangs on (0 = none) */ parent?: number;
  /** engine on (driver present / ignition); default: occupied seat 0 or |speed| >= 0.25 */ on?: boolean;
  /** core VehicleState byte (ADR-101): bit 0 engineOn, bit 1 headlights. When present it gates the headlight cone. */ state?: number;
}
export interface VehicleViewOpts {
  /** 0 (day) .. 1 (night); headlights scale with it and are off below ~0.15 */ darkness: number;
  lowEnd?: boolean;
  /** rider key of the local player (cutaway when seated in an interior vehicle) */ localRider?: number;
  /** local player's world position (cutaway when standing inside a parked interior vehicle) */ localPos?: { x: number; y: number };
  /** localPlayerVehicle(world, eid) from gameplay (net id of the vehicle the local player drives, or null): cutaway it */ localVehicle?: number | null;
  /** rider keys are entities of this view world: suppress their ground Shadow while seated (default true; Art 64357f1) */ riderShadows?: boolean;
  /** drift yaw added to the drawn heading (fraction of Vehicle.drift) */ driftYaw?: number;
  /** World (tile) position on screen? Off-screen vehicles skip their streamed art page (no pageReady touch), so the
   *  LRU can evict it for visible ones; without this a full pool of off-screen pages starves e.g. car_compact. */
  inView?: (x: number, y: number) => boolean;
}
export interface VehicleSpatial { insert(e: Entity, x: number, y: number): void; remove(e: Entity): void }
export interface RiderPlacement { rider: number; vehicle: number; seat: number; x: number; y: number; z: number; facing: number; cropped: boolean }
export interface VehiclePose { x: number; y: number; z: number; heading: number; dir: number; interior: boolean }

interface Rec { smooth: PoseSmoother; segs: Entity[]; segIds: number[]; intIds: number[]; lights: Entity[]; def: VehicleRenderDef; pose: VehiclePose; seen: number;
  art: VehicleArtBinding | null; body: Entity | undefined; zk: number }
/** Streaming hooks (AtlasManager): Art vehicle sheets are retained per live vehicle and released when it leaves. */
export interface VehiclePages { retainSprite(id: number): void; releaseSprite(id: number): void; pageReady(id: number): boolean }
export const VEHICLE_STATE_ENGINE_ON = 1, VEHICLE_STATE_HEADLIGHTS = 2;

export class VehicleView {
  readonly recs = new Map<number, Rec>();
  /** Open interiors this frame (local player inside) for the sprite interior pass: IsoRenderer.setInterior(view.interiors, view.interiorIds, view.interiorWall). */
  readonly interiors: InteriorRegion[] = [];
  /** _int cutaway segment sprite ids (routed as interior floor). */
  readonly interiorIds = new Set<number>();
  /** Art camper_interior_wall sprite id (-1 = not in the pack; -2 = not looked up yet). */
  interiorWall = -2;
  private readonly art: boolean | VehicleArtTable | undefined; private readonly pages: VehiclePages | undefined;
  private frame = 0;
  /** Visible vehicles with an Art binding whose streamed page is not resident yet (placeholder shown); 0 = all Art. */
  artPending = 0;
  /** seated rider entity -> its Shadow alpha before seating (restored on exit) */
  private readonly hiddenShadow = new Map<number, number>();
  private readonly iso: { tileH: number; zStep: number }; private readonly zf: number; private readonly spatial: VehicleSpatial | undefined;
  /** spatial: the renderer's chunked index when setSpatialIndex is used (proxies must be in it to be drawn). */
  constructor(private readonly world: World, private readonly registry: AssetRegistry, o: { iso?: { tileH: number; zStep: number }; zFactor?: number; spatial?: VehicleSpatial; art?: boolean | VehicleArtTable; pages?: VehiclePages } = {}) {
    this.art = o.art; this.pages = o.pages;
    this.iso = o.iso ?? { tileH: 32, zStep: 16 }; this.zf = o.zFactor ?? 1 / 3; this.spatial = o.spatial;
  }

  pose(key: number): VehiclePose | undefined { return this.recs.get(key)?.pose; }

  sync(list: readonly VehicleSnapshot[], dt: number, o: VehicleViewOpts): RiderPlacement[] {
    const w = this.world; this.frame++; const out: RiderPlacement[] = [];
    this.interiors.length = 0; this.interiorIds.clear(); this.artPending = 0;
    if (this.interiorWall === -2) this.interiorWall = this.sid(ART_INTERIOR.wall);
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
      const inside = hasInterior(s.def) && ((o.localVehicle != null && o.localVehicle === s.key) || (o.localRider !== undefined && o.localRider !== 0 && occ.includes(o.localRider)) || (!!o.localPos && insideFootprint(s.def, x, y, h, o.localPos.x, o.localPos.y, -0.1)));
      r.pose = { x, y, z, heading: h, dir, interior: inside };
      if (inside) { this.interiors.push({ cx: x, cy: y, heading: dirAngle(dir), length: s.def.footprint.length, width: s.def.footprint.width }); for (const id of r.intIds) if (id >= 0) this.interiorIds.add(id); }
      // segments: positions on the QUANTIZED heading so the pieces line up with the art row
      const n = r.segs.length;
      // Art body: one billboard (8-dir row = heading + art offset), shown once its streamed page is resident; the
      // placeholder segments stay visible meanwhile (and in the interior cutaway - Art has no per-segment _int pieces).
      const vis = !o.inView || o.inView(x, y);
      const artOn = !!r.art && r.body !== undefined && !inside && vis && (!this.pages || this.pages.pageReady(r.art.spriteId));
      if (r.art && r.body !== undefined && !inside && vis && !artOn) this.artPending++;
      if (r.body !== undefined) {
        const b = r.body; w.set(b, Transform, { x, y, z, facing: hq + r.art!.facingOffset });
        const sp = w.get(b, Sprite)!; const sc = r.art!.scale;
        if (sp.scale !== sc) w.set(b, Sprite, { ...sp, scale: sc });
        if (artOn) this.spatial?.insert(b, x, y); else this.spatial?.remove(b);
      }
      for (let i = 0; i < n; i++) {
        const [sx, sy] = toWorld(x, y, hq, segmentU(s.def, i), 0); const e = r.segs[i]!;
        w.set(e, Transform, { x: sx, y: sy, z, facing: h }); if (artOn) this.spatial?.remove(e); else this.spatial?.insert(e, sx, sy); // Sprite.scale 0 draws at 1: hide via the index
        const id = inside && r.intIds[i]! >= 0 ? r.intIds[i]! : r.segIds[i]!; const sp = w.get(e, Sprite);
        const fl = inside ? SpriteFlag.Footprint | SpriteFlag.Cutaway : SpriteFlag.Footprint; // cutaway: no height depth so the occupant stands on the floor
        if (sp && (sp.spriteId !== id || sp.flags !== fl)) w.set(e, Sprite, { ...sp, spriteId: id, flags: fl });
        if (w.has(e, Occluder) && (inside || artOn)) w.remove(e, Occluder);
        else if (!w.has(e, Occluder) && !inside && !artOn && modelHeight(s.def) > PLAYER_HEIGHT_Z) w.add(e, Occluder, { fade: 0.45 });
      }
      // headlights
      const on = isPowered(s.def) && (s.state !== undefined ? (s.state & VEHICLE_STATE_HEADLIGHTS) !== 0 && (s.state & VEHICLE_STATE_ENGINE_ON) !== 0
        : (s.on ?? ((occ[0] ?? 0) !== 0 || Math.abs(s.speed ?? 0) >= 0.25)));
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
      const seats = seatAnchors(s.def, r.zk);
      for (let i = 0; i < occ.length; i++) {
        const rid = occ[i]!; if (!rid) continue; const a = seats[i] ?? { u: 0, v: 0, z: 0, cabin: false };
        const [px, py] = toWorld(x, y, hq, a.u, a.v); const p = { x: px, y: py, z: z + a.z };
        // depth relative to the seat's segment centre
        const si = Math.min(n - 1, Math.max(0, Math.floor((s.def.footprint.length / 2 - a.u) / (s.def.footprint.length / n))));
        const [cx, cy] = toWorld(x, y, hq, segmentU(s.def, si), 0); const segKey = cx + cy + z * this.zf, key = p.x + p.y + p.z * this.zf;
        depthNudge(p, segKey + (a.cabin ? RIDER_DK_CABIN : RIDER_DK_OPEN) - key, this.iso, this.zf);
        out.push({ rider: rid, vehicle: s.key, seat: i, x: p.x, y: p.y, z: p.z, facing: hq, cropped: a.cabin });
      }
    }
    for (const [k, r] of this.recs) if (r.seen !== this.frame) { this.drop(r); this.recs.delete(k); }
    if (o.riderShadows !== false) {
      const now = new Set(out.map((p) => p.rider));
      for (const rid of now) { const e = rid as Entity; if (this.hiddenShadow.has(rid) || !w.isAlive(e)) continue; const sh = shadowOf(w, e); if (sh) { this.hiddenShadow.set(rid, sh.alpha); if (sh.alpha !== 0) w.set(e, Shadow, { ...sh, alpha: 0 }); } }
      for (const [rid, a] of this.hiddenShadow) if (!now.has(rid)) { const e = rid as Entity; this.hiddenShadow.delete(rid); const sh = w.isAlive(e) ? shadowOf(w, e) : undefined; if (sh) w.set(e, Shadow, { ...sh, alpha: a }); }
    }
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
    const art = this.art ? resolveVehicleArt(this.registry, def, this.art === true ? undefined : this.art) : null; let body: Entity | undefined;
    if (art) { body = w.create(); w.add(body, Transform, { x: 0, y: 0, z: 0, facing: 0 }); w.add(body, Sprite, { spriteId: art.spriteId, frameId: 0, flags: SpriteFlag.Footprint, scale: art.scale, tint: 0 }); this.pages?.retainSprite(art.spriteId); }
    return { smooth: new PoseSmoother(), segs, segIds, intIds, lights: [], def, pose: { x: 0, y: 0, z: 0, heading: 0, dir: 0, interior: false }, seen: 0, art, body, zk: modelZScale(def) };
  }
  private drop(r: Rec): void {
    if (r.art && r.body !== undefined) this.pages?.releaseSprite(r.art.spriteId);
    for (const e of [...r.segs, ...r.lights, ...(r.body !== undefined ? [r.body] : [])]) { this.spatial?.remove(e); if (this.world.isAlive(e)) this.world.destroy(e); } r.segs = []; r.lights = []; r.body = undefined;
  }
  dispose(): void { for (const r of this.recs.values()) this.drop(r); this.recs.clear(); }
}
function depthOf(s: VehicleSnapshot, m: Map<number, VehicleSnapshot>): number { let d = 0, c = s; while (c.parent && d < 8) { const p = m.get(c.parent); if (!p) break; c = p; d++; } return d; }

function shadowOf(w: World, e: Entity): { alpha: number; length: number } | undefined { try { return w.get(e, Shadow) as { alpha: number; length: number } | undefined; } catch { return undefined; } }
