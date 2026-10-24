/**
 * DEMO ?vehicles=1|camper: a parked lot of procedural vehicles next to the base. A pickup + camper trailer and a sedan
 * drive circles (snapshots updated at the 20 Hz tick so VehicleView's smoothing is exercised; the trailer follows a
 * pin joint like core's), a semi + box trailer is parked diagonally (long-footprint depth sorting), riders sit at seat
 * anchors in AnimState Idle. ?vehicles=camper puts the local player inside the parked RV (interior cutaway).
 * Defs come from @engine/gameplay's data JSON (demo only; packages/render never imports gameplay).
 */
import { PrevTransform, Transform, type Entity, type World } from "@engine/core";
import type { AssetRegistry, ManifestJson } from "@engine/assets";
import type { ChunkedSpatialIndex } from "@engine/world";
import raw from "../../gameplay/data/vehicles.json";
import { Sprite, buildVehicleDebugPack, VehicleView, toWorld, wrapAngle, hitchU, type VehicleRenderDef, type VehicleSnapshot, type VehiclePack } from "../src/index.js";
import type { AtlasSource } from "../src/index.js";
import { AnimState, AnimStateId } from "./mockGameplay.js";

const ALL = ((raw as { vehicles?: unknown }).vehicles ?? raw) as unknown as VehicleRenderDef[];
const def = (id: string): VehicleRenderDef => ALL.find((d) => d.id === id)!;
const USED = ["camper_rv", "truck_pickup", "trailer_camper", "car_sedan", "semi_tractor", "semi_trailer_box", "bike_basic", "car_compact", "truck_flatbed", "trailer_tanker"];

export async function vehicleDemoPack(): Promise<VehiclePack> { return buildVehicleDebugPack(USED.map(def)); }
export type ManifestPatch = (m: ManifestJson) => Promise<{ manifest: ManifestJson; sources: Map<string, AtlasSource> }>;
export const vehicleManifestPatch: ManifestPatch = async (m) => { const p = await vehicleDemoPack(); return { manifest: p.patch(m), sources: p.sources }; };

interface Mover { snap: VehicleSnapshot; cx: number; cy: number; r: number; w: number; ph: number }

export function setupVehicleDemo(world: World, reg: AssetRegistry, o: { x: number; y: number; players: Entity[]; player: Entity; camper: boolean; index?: ChunkedSpatialIndex; lowEnd: boolean }) {
  // clear the lot (trees / rocks / loot sprites) so the vehicles read
  { const sp = world.store(Sprite), keep = new Set<Entity>(o.players); const kill: Entity[] = [];
    for (let k = 0; k < sp.size; k++) { const e = sp.dense[k]! as Entity; if (keep.has(e)) continue; const t = world.get(e, Transform); if (t && t.x > o.x - 6 && t.x < o.x + 22 && t.y > o.y - 5 && t.y < o.y + 27) kill.push(e); }
    for (const e of kill) { o.index?.remove(e); world.destroy(e); } }
  const view = new VehicleView(world, reg, o.index ? { spatial: o.index } : {});
  const { x, y } = o; const riders = o.players.slice(1);
  const rv: VehicleSnapshot = { key: 1, def: def("camper_rv"), x: x + 1, y: y + 3, heading: Math.PI / 2, occupants: [0, 0, 0, 0, 0, 0], on: false };
  const semi: VehicleSnapshot = { key: 2, def: def("semi_tractor"), x: x + 9, y: y + 1, heading: Math.PI / 4, on: true };
  const box: VehicleSnapshot = { key: 3, def: def("semi_trailer_box"), x: 0, y: 0, heading: Math.PI / 4 + 0.25, parent: 2 };
  const parked: VehicleSnapshot[] = [rv, semi, box,
    { key: 4, def: def("car_compact"), x: x + 5, y: y + 9, heading: Math.PI, on: false },
    { key: 5, def: def("truck_flatbed"), x: x - 3, y: y + 11, heading: -Math.PI / 2, on: false },
    { key: 6, def: def("bike_basic"), x: x + 6.5, y: y + 6, heading: 0.7, occupants: [riders[1] ?? 0], speed: 0, on: true }];
  const movers: Mover[] = [
    { snap: { key: 10, def: def("car_sedan"), x: 0, y: 0, heading: 0, occupants: [riders[0] ?? 0, 0, 0, 0], speed: 4 }, cx: x + 14, cy: y + 12, r: 5, w: 0.5, ph: 0 },
    { snap: { key: 11, def: def("truck_pickup"), x: 0, y: 0, heading: 0, occupants: [0, 0, 0], speed: 3, on: true }, cx: x + 2, cy: y + 19, r: 6, w: -0.35, ph: 1.5 },
  ];
  const trailer: VehicleSnapshot = { key: 12, def: def("trailer_camper"), x: 0, y: 0, heading: 0, parent: 11 };
  // semi trailer: parked, place from the pin
  const pinS = toWorld(semi.x, semi.y, semi.heading, hitchU(semi.def, "rear")!, 0), f = hitchU(box.def, "front")!;
  box.x = pinS[0] - Math.cos(box.heading) * f; box.y = pinS[1] - Math.sin(box.heading) * f;
  if (o.camper) { rv.occupants = [0, 0, 0, 0, 0, 0]; rv.heading = -Math.PI / 2; } // rear toward the camera: the player stands in the nearest interior segment // local player stands inside (localPos), see frame()
  let lastTick = -1, t = 0, tr0 = true;
  const step = (dt: number): void => {
    t += dt;
    for (const m of movers) {
      const a = m.ph + t * m.w; m.snap.x = m.cx + Math.cos(a) * m.r; m.snap.y = m.cy + Math.sin(a) * m.r;
      m.snap.heading = wrapAngle(a + Math.sign(m.w) * Math.PI / 2); m.snap.drift = Math.sign(m.w) * 0.15;
    }
    // pin joint (core: h = atan2(pin - trailer centre), clamped)
    const tw = movers[1]!.snap, pin = toWorld(tw.x, tw.y, tw.heading, hitchU(tw.def, "rear")!, 0), fo = hitchU(trailer.def, "front")!;
    if (tr0) { trailer.heading = tw.heading; tr0 = false; }
    else { let h = Math.atan2(pin[1] - trailer.y, pin[0] - trailer.x); const rel = wrapAngle(h - tw.heading); if (Math.abs(rel) > 1.75) h = tw.heading + Math.sign(rel) * 1.75; trailer.heading = h; }
    trailer.x = pin[0] - Math.cos(trailer.heading) * fo; trailer.y = pin[1] - Math.sin(trailer.heading) * fo;
  };
  step(0); step(0.05);
  const stand = toWorld(rv.x, rv.y, rv.heading, o.camper ? -3.3 : -2.2, 0.35);
  return {
    view,
    focus: o.camper ? { x: stand[0], y: stand[1] } : { x: x + 6, y: y + 8 },
    frame(dark: number, dt: number): void {
      if (world.tick !== lastTick) { lastTick = world.tick; step(0.05); } // net-rate snapshots
      const list = [...parked, ...movers.map((m) => m.snap), trailer];
      const local = o.camper ? { x: stand[0], y: stand[1] } : undefined;
      const placed = view.sync(list, dt, { darkness: dark, lowEnd: o.lowEnd, ...(local ? { localPos: local } : {}), localRider: 0, driftYaw: 0.3 });
      const put = (e: Entity, p: { x: number; y: number; z: number; facing: number }): void => {
        world.set(e, Transform, p); if (world.has(e, PrevTransform)) world.set(e, PrevTransform, p); o.index?.insert(e, p.x, p.y);
        if (world.has(e, AnimState)) { const a = world.get(e, AnimState)!; if (a.state !== AnimStateId.Idle) world.set(e, AnimState, { ...a, state: AnimStateId.Idle }); }
      };
      for (const p of placed) put(p.rider as Entity, p);
      if (local) put(o.player, { x: stand[0], y: stand[1], z: 0.3, facing: rv.heading + Math.PI / 2 });
    },
  };
}
