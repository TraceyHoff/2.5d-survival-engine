/**
 * Procedural placeholder vehicle model (pure): a list of local boxes per def, used by the DEBUG atlas painter and as the
 * reference silhouette for Art (docs/VEHICLES_RENDER.md). u along the heading (+ front), v left, z up (world z units).
 */
import { targetHeightZ } from "./scale.js";
import { hasInterior, segmentCount, segmentU, type VehicleRenderDef } from "./layout.js";

export type BoxKind = "solid" | "glass" | "wheel" | "lamp" | "station";
export interface Box { u0: number; u1: number; v0: number; v1: number; z0: number; z1: number; kind: BoxKind; color: number }

const PAINT = [0xb8402e, 0x2f6fb0, 0x3f8a4a, 0xd0a030, 0x7a7f86, 0xe6e2d6, 0x5b3d7a, 0x2c2f33];
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export const paintColor = (d: VehicleRenderDef): number => PAINT[hash(d.id) % PAINT.length]!;
const STATION_COLOR: Record<string, number> = { campfire: 0x9a9da3, workbench: 0x8a5a2b, furnace: 0x5a5d63 };

/** Max model height (z units, stylized - see scale.ts) - used for the atlas frame size. */
export function modelHeight(d: VehicleRenderDef): number { return Math.max(...vehicleModel(d, false).map((b) => b.z1)); }
/** Roof height of the literal (1 z = 1 m) model - what vehicles.json seat z values were authored against. */
export function literalModelHeight(d: VehicleRenderDef): number { return Math.max(...literalModel(d, false).map((b) => b.z1)); }
/** Vertical stretch literal -> stylized (targetHeightZ / literal roof). */
export function modelZScale(d: VehicleRenderDef): number { const h = literalModelHeight(d); return h > 0 ? targetHeightZ(d) / h : 1; }

/** Placeholder boxes, z stretched so the roof matches the per-type target height (taller body + ground clearance). */
export function vehicleModel(d: VehicleRenderDef, interior: boolean): Box[] {
  const k = modelZScale(d);
  return literalModel(d, interior).map((b) => ({ ...b, z0: b.z0 * k, z1: b.z1 * k }));
}

function literalModel(d: VehicleRenderDef, interior: boolean): Box[] {
  const L = d.footprint.length, W = d.footprint.width, hl = L / 2, hw = W / 2, col = paintColor(d);
  const out: Box[] = []; const B = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, kind: BoxKind, color = col): void => { out.push({ u0, u1, v0, v1, z0, z1, kind, color }); };
  const wheels = (us: number[], r: number, wv = 0.22): void => { for (const u of us) for (const s of [1, -1]) B(u - r, u + r, s * hw - (s > 0 ? wv : 0), s * hw + (s < 0 ? wv : 0), 0, r * 1.6, "wheel", 0x1d1d1f); };
  const lamps = (z: number): void => { for (const s of [1, -1]) B(hl - 0.06, hl, s * hw * 0.32 - 0.14, s * hw * 0.32 + 0.14, z, z + 0.14, "lamp", 0xfff2b0); };
  /** Cabin: glass band + roof slab between u0..u1 (beltline zb, roof zr). */
  const cabin = (u0: number, u1: number, zb: number, zr: number): void => { B(u0, u1, -hw + 0.08, hw - 0.08, zb, zr - 0.1, "glass", 0x9cc4e0); B(u0 - 0.05, u1 + 0.05, -hw + 0.05, hw - 0.05, zr - 0.1, zr, "solid"); };
  /** Hollow walls (interior cutaway): floor + 4 thin walls up to zw, stations along the centreline. */
  const hollow = (u0: number, u1: number, zf: number, zw: number, stations: readonly string[]): void => {
    B(u0, u1, -hw, hw, zf - 0.05, zf, "solid", 0xb89a6a); const t = 0.1;
    B(u0, u1, hw - t, hw, zf, zw, "solid"); B(u0, u1, -hw, -hw + t, zf, zw, "solid"); B(u1 - t, u1, -hw, hw, zf, zw, "solid"); B(u0, u0 + t, -hw, hw, zf, zw, "solid");
    const n = stations.length; for (let i = 0; i < n; i++) { const c = u1 - (u1 - u0) * (i + 0.5) / n; B(c - 0.3, c + 0.3, -0.35, 0.35, zf, zf + 0.55, "station", STATION_COLOR[stations[i]!] ?? 0x8a7a60); }
    // bed along the left wall
    B(u0 + 0.15, u0 + 1.1, hw - 0.85, hw - 0.12, zf, zf + 0.3, "station", 0x4b6aa8);
  };
  switch (d.class) {
    case "bicycle": {
      const r = 0.34, us = [hl - r - 0.05, -hl + r + 0.05];
      for (const u of us) B(u - r, u + r, -0.04, 0.04, 0, r * 2, "wheel", 0x1d1d1f);
      if (d.footprint.width > 0.9) B(us[1]! - r, us[1]! + r, -hw, -hw + 0.08, 0, r * 2, "wheel", 0x1d1d1f), B(us[1]! - r, us[1]! + r, hw - 0.08, hw, 0, r * 2, "wheel", 0x1d1d1f);
      B(us[1]!, us[0]!, -0.04, 0.04, r * 1.2, r * 1.5, "solid"); B(us[0]! - 0.05, us[0]! + 0.05, -0.05, 0.05, r * 1.5, 0.95, "solid");
      B(us[0]! - 0.06, us[0]! + 0.04, -0.28, 0.28, 0.92, 0.98, "solid", 0x2c2f33); B(-0.2, 0.15, -0.08, 0.08, 0.78, 0.84, "solid", 0x2c2f33);
      if (d.id.includes("cargo")) B(us[0]! - 0.3, us[0]! + 0.25, -0.35, 0.35, 0.45, 0.7, "solid", 0x8a5a2b);
      lamps(0.85); out.splice(out.length - 2, 2); B(hl - 0.08, hl, -0.06, 0.06, 0.8, 0.9, "lamp", 0xfff2b0);
      break;
    }
    case "car": {
      wheels([hl - 0.8, -hl + 0.8], 0.32);
      const tall = d.id.includes("offroad") ? 0.15 : 0; B(-hl, hl, -hw, hw, 0.22 + tall, 0.72 + tall, "solid");
      cabin(-hl * (d.id.includes("wagon") ? 0.85 : 0.5), hl * 0.25, 0.72 + tall, 1.3 + tall); lamps(0.5 + tall); break;
    }
    case "truck": {
      wheels([hl - 0.9, -hl + 1.0, -hl + 2.0].slice(0, L > 6 ? 3 : 2), 0.38);
      const cabL = Math.min(2.6, L * 0.38); B(hl - cabL, hl, -hw, hw, 0.3, 0.95, "solid"); cabin(hl - cabL + 0.1, hl - 0.7, 0.95, 1.65);
      const bedTop = d.id.includes("box") ? 2.3 : d.id.includes("flatbed") ? 0.55 : 1.0;
      if (bedTop > 1.5) B(-hl, hl - cabL - 0.1, -hw, hw, 0.35, bedTop, "solid", 0xd8d6cf);
      else { B(-hl, hl - cabL - 0.1, -hw, hw, 0.35, 0.5, "solid"); if (bedTop > 0.6) for (const s of [1, -1]) B(-hl, hl - cabL - 0.1, s > 0 ? hw - 0.1 : -hw, s > 0 ? hw : -hw + 0.1, 0.5, bedTop, "solid"); }
      lamps(0.55); break;
    }
    case "van": {
      wheels([hl - 0.9, -hl + 0.9], 0.34); B(-hl, hl, -hw, hw, 0.25, 0.85, "solid"); B(-hl, hl - 1.0, -hw, hw, 0.85, 1.9, "solid");
      cabin(hl - 1.6, hl - 0.5, 0.85, 1.9); lamps(0.55); break;
    }
    case "camper": {
      wheels([hl - 1.0, -hl + 1.3], 0.36);
      const cabL = d.id.includes("rv") ? 1.6 : 1.4; B(hl - cabL, hl, -hw, hw, 0.28, 0.9, "solid"); cabin(hl - cabL + 0.1, hl - 0.6, 0.9, 1.75);
      if (interior) hollow(-hl, hl - cabL, 0.3, 0.7, d.interior.stations);
      else { B(-hl, hl - cabL, -hw, hw, 0.28, 2.25, "solid", 0xe6e2d6); B(-hl, hl - cabL, hw - 0.02, hw, 1.0, 1.15, "solid"); B(-hl, hl - cabL, -hw, -hw + 0.02, 1.0, 1.15, "solid"); }
      lamps(0.55); break;
    }
    case "semi": {
      wheels([hl - 1.0, -hl + 1.0, -hl + 2.2], 0.45); B(hl - 2.6, hl, -hw, hw, 0.4, 1.3, "solid"); cabin(hl - 2.5, hl - 0.9, 1.3, 2.4);
      B(hl - 3.6, hl - 2.6, -hw + 0.1, hw - 0.1, 0.4, 2.3, "solid"); B(-hl, hl - 3.6, -hw * 0.6, hw * 0.6, 0.45, 0.75, "solid", 0x3a3c40);
      lamps(0.7); break;
    }
    default: { // trailer
      const big = L > 10; wheels(big ? [-hl + 1.0, -hl + 2.2] : [-hl * 0.15], big ? 0.45 : 0.34);
      B(hl - 0.1, hitchFront(d), -0.06, 0.06, 0.3, 0.42, "solid", 0x3a3c40);
      const deck = big ? 0.9 : 0.4;
      if (d.id.includes("tanker")) { B(-hl, hl, -hw * 0.4, hw * 0.4, deck - 0.1, deck + 0.05, "solid", 0x3a3c40); B(-hl + 0.2, hl - 0.2, -hw * 0.85, hw * 0.85, deck, 2.0, "solid", 0xc8ccd2); }
      else if (d.id.includes("camper")) { if (interior) hollow(-hl, hl, deck, deck + 0.4, d.interior.stations); else { B(-hl, hl, -hw, hw, deck, 2.25, "solid", 0xe6e2d6); B(-hl, hl, hw - 0.02, hw, 1.0, 1.15, "solid"); B(-hl, hl, -hw, -hw + 0.02, 1.0, 1.15, "solid"); } }
      else if (d.id.includes("box") || d.id.includes("cargo")) B(-hl, hl, -hw, hw, deck, big ? 3.2 : 1.6, "solid", 0xd8d6cf);
      else if (d.id.includes("livestock")) { B(-hl, hl, -hw, hw, deck, deck + 0.1, "solid", 0x6b5233); for (const s of [1, -1]) for (let z = deck + 0.35; z < 1.7; z += 0.4) B(-hl, hl, s > 0 ? hw - 0.08 : -hw, s > 0 ? hw : -hw + 0.08, z, z + 0.14, "solid", 0x8a6a44); }
      else { B(-hl, hl, -hw, hw, deck, deck + 0.15, "solid", 0x6b5233); if (!big && !d.id.includes("flatbed")) for (const s of [1, -1]) B(-hl, hl, s > 0 ? hw - 0.08 : -hw, s > 0 ? hw : -hw + 0.08, deck + 0.15, deck + 0.5, "solid"); }
    }
  }
  return out;
}
const hitchFront = (d: VehicleRenderDef): number => Math.min(d.footprint.length / 2 + 0.9, d.hitches.find((h) => h.at === "front")?.anchor?.x ?? d.footprint.length / 2);

/** Boxes clipped to segment i (u-range), re-centred on the segment centre; `cut` marks faces created by the clip. */
export interface SegBox extends Box { cutFront: boolean; cutRear: boolean }
export function segmentBoxes(d: VehicleRenderDef, i: number, interior: boolean): SegBox[] {
  const n = segmentCount(d), len = d.footprint.length / n, c = segmentU(d, i), a = c - len / 2, b = c + len / 2; const out: SegBox[] = [];
  const first = i === 0, last = i === n - 1;
  for (const bx of vehicleModel(d, interior)) {
    // drawbars / overhangs beyond the footprint belong to the end segments
    const lo = last ? -Infinity : a, hi = first ? Infinity : b;
    const u0 = Math.max(bx.u0, lo), u1 = Math.min(bx.u1, hi); if (u1 - u0 <= 1e-4) continue;
    out.push({ ...bx, u0: u0 - c, u1: u1 - c, cutFront: u1 < bx.u1 - 1e-4, cutRear: u0 > bx.u0 + 1e-4 });
  }
  return out;
}
export const segmentHasInterior = (d: VehicleRenderDef): boolean => hasInterior(d);
