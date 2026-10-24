/**
 * DEBUG procedural vehicle atlases (browser; OffscreenCanvas) in the exact layout Art will ship
 * (docs/VEHICLES_RENDER.md): one atlas per vehicle def `veh_<id>`, columns = segments (exterior) + segments (interior
 * cutaway, campers only), rows = 8 directions (row r = heading r*45deg, 0 = +x tile axis); sprites `veh_<id>_s<i>` and
 * `veh_<id>_s<i>_int` with one 8-direction "idle" animation (frames [i], dirStride = columns). Pivot = segment centre
 * on the ground. Replace with Art's sheets by shipping the same keys in the pack (the patch never overrides pack keys).
 */
import type { ManifestJson } from "@engine/assets";
import type { AtlasSource } from "../assets/atlasManager.js";
import { dirAngle, hasInterior, segmentCount, type VehicleRenderDef } from "./layout.js";
import { segmentBoxes, type SegBox } from "./model.js";

type SpriteJson = ManifestJson["sprites"][number]; type AtlasJson = ManifestJson["atlases"][number];
export interface IsoPx { hw: number; hh: number; zs: number }
export const ISO_PX: IsoPx = { hw: 32, hh: 16, zs: 16 };
export const vehicleSpriteKey = (id: string, seg: number, interior = false): string => `veh_${id}_s${seg}${interior ? "_int" : ""}`;
export const vehicleAtlasKey = (id: string): string => `veh_${id}`;

const proj = (u: number, v: number, z: number, h: number, p: IsoPx): [number, number] => {
  const c = Math.cos(h), s = Math.sin(h), dx = c * u - s * v, dy = s * u + c * v; return [(dx - dy) * p.hw, (dx + dy) * p.hh - z * p.zs];
};
const corners = (b: SegBox): [number, number, number][] => { const o: [number, number, number][] = []; for (const u of [b.u0, b.u1]) for (const v of [b.v0, b.v1]) for (const z of [b.z0, b.z1]) o.push([u, v, z]); return o; };

/** Frame size + pivot (px) covering every segment of a def in all 8 directions, both variants. */
export function vehicleFrame(d: VehicleRenderDef, p: IsoPx = ISO_PX): { w: number; h: number; px: number; py: number } {
  let mx = 1, up = 1, down = 1; const n = segmentCount(d);
  for (let i = 0; i < n; i++) for (const int of [false, true]) for (const b of segmentBoxes(d, i, int)) for (let r = 0; r < 8; r++) for (const [u, v, z] of corners(b)) {
    const [x, y] = proj(u, v, z, dirAngle(r), p); mx = Math.max(mx, Math.abs(x)); up = Math.max(up, -y); down = Math.max(down, y);
  }
  const pad = 3; const w = 2 * Math.ceil(mx + pad), h = Math.ceil(up + pad) + Math.ceil(down + pad);
  return { w, h, px: w / 2, py: Math.ceil(up + pad) };
}

const rgb = (c: number, k: number, a = 1): string => `rgba(${Math.min(255, ((c >> 16) & 255) * k) | 0},${Math.min(255, ((c >> 8) & 255) * k) | 0},${Math.min(255, (c & 255) * k) | 0},${a})`;

/** Paint one segment's boxes for heading h at pivot (ox, oy). Visible faces only (normal faces the camera: nx + ny > 0). */
export function paintSegment(g: OffscreenCanvasRenderingContext2D, boxes: SegBox[], h: number, ox: number, oy: number, p: IsoPx = ISO_PX): void {
  const c = Math.cos(h), s = Math.sin(h); const depth = (b: SegBox): number => { const u = (b.u0 + b.u1) / 2, v = (b.v0 + b.v1) / 2; return c * u - s * v + s * u + c * v + b.z0 * 0.5 + (b.kind === "lamp" ? 9 : 0); };
  const sorted = [...boxes].sort((a, b) => depth(a) - depth(b));
  for (const b of sorted) {
    const P = (u: number, v: number, z: number): [number, number] => { const [x, y] = proj(u, v, z, h, p); return [ox + x, oy + y]; };
    const quad = (pts: [number, number][], fill: string, stroke: string | null): void => {
      g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k]![0], pts[k]![1]); g.closePath();
      g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
    };
    const glass = b.kind === "glass"; const lamp = b.kind === "lamp";
    // side faces: [normal(u,v), polygon]
    const faces: [number, number, [number, number, number][] , boolean][] = [
      [1, 0, [[b.u1, b.v0, b.z0], [b.u1, b.v1, b.z0], [b.u1, b.v1, b.z1], [b.u1, b.v0, b.z1]], b.cutFront],
      [-1, 0, [[b.u0, b.v0, b.z0], [b.u0, b.v1, b.z0], [b.u0, b.v1, b.z1], [b.u0, b.v0, b.z1]], b.cutRear],
      [0, 1, [[b.u0, b.v1, b.z0], [b.u1, b.v1, b.z0], [b.u1, b.v1, b.z1], [b.u0, b.v1, b.z1]], false],
      [0, -1, [[b.u0, b.v0, b.z0], [b.u1, b.v0, b.z0], [b.u1, b.v0, b.z1], [b.u0, b.v0, b.z1]], false],
    ];
    for (const [nu, nv, poly, cut] of faces) {
      const nx = c * nu - s * nv, ny = s * nu + c * nv; if (nx + ny <= 1e-6 || cut) continue;
      const k = 0.62 + 0.25 * (nx - ny) * 0.7 + 0.1; const pts = poly.map(([u, v, z]) => P(u, v, z));
      if (glass) quad(pts, "rgba(120,170,205,0.35)", rgb(0x22282e, 1));
      else quad(pts, lamp ? rgb(b.color, 1) : rgb(b.color, k), b.kind === "wheel" ? null : rgb(b.color, k * 0.6, 0.9));
    }
    if (!glass) quad([P(b.u0, b.v0, b.z1), P(b.u1, b.v0, b.z1), P(b.u1, b.v1, b.z1), P(b.u0, b.v1, b.z1)], rgb(b.color, lamp ? 1 : 1.12), b.kind === "wheel" ? null : rgb(b.color, 0.7, 0.8));
  }
}

/** Pure manifest entries (atlas + sprites) for a def in the shipped layout; image = `debug/veh_<id>.png`. */
export function vehicleManifestEntries(d: VehicleRenderDef, category = "item"): { atlas: AtlasJson; sprites: SpriteJson[]; frame: ReturnType<typeof vehicleFrame>; cols: number } {
  const n = segmentCount(d), cols = n * (hasInterior(d) ? 2 : 1), f = vehicleFrame(d), key = vehicleAtlasKey(d.id);
  const sprites: SpriteJson[] = [];
  for (let col = 0; col < cols; col++) sprites.push({ key: vehicleSpriteKey(d.id, col % n, col >= n), category, atlas: key, anchor: { x: f.px / f.w, y: f.py / f.h },
    animations: { idle: { frames: [col], fps: 1, directions: 8, dirStride: cols } } } as unknown as SpriteJson);
  return { atlas: { key, image: `debug/${key}.png`, frameW: f.w, frameH: f.h, columns: cols, rows: 8 } as AtlasJson, sprites, frame: f, cols };
}

export interface VehiclePack { patch(m: ManifestJson): ManifestJson; sources: Map<string, AtlasSource> }

/** Build DEBUG atlases for the given defs. Keys already present in the manifest (Art's sheets) are left untouched. */
export async function buildVehicleDebugPack(defs: readonly VehicleRenderDef[], category = "item"): Promise<VehiclePack> {
  const atlases: AtlasJson[] = []; const sprites: SpriteJson[] = []; const sources = new Map<string, AtlasSource>();
  for (const d of defs) {
    const n = segmentCount(d), ent = vehicleManifestEntries(d, category), f = ent.frame, cols = ent.cols;
    const cv = new OffscreenCanvas(f.w * cols, f.h * 8); const g = cv.getContext("2d")!;
    for (let r = 0; r < 8; r++) for (let col = 0; col < cols; col++) {
      g.save(); g.beginPath(); g.rect(col * f.w, r * f.h, f.w, f.h); g.clip();
      paintSegment(g, segmentBoxes(d, col % n, col >= n), dirAngle(r), col * f.w + f.px, r * f.h + f.py); g.restore();
    }
    atlases.push(ent.atlas); sprites.push(...ent.sprites);
    sources.set(ent.atlas.key, { url: URL.createObjectURL(await cv.convertToBlob({ type: "image/png" })), emissiveUrl: null });
  }
  return {
    sources,
    patch(m) {
      const ak = new Set(m.atlases.map((a) => a.key)), sk = new Set(m.sprites.map((s) => s.key));
      for (const k of ak) sources.delete(k); // Art's sheet wins: drop the placeholder source
      return { ...m, atlases: [...m.atlases, ...atlases.filter((a) => !ak.has(a.key))], sprites: [...m.sprites, ...sprites.filter((s) => !sk.has(s.key) && !ak.has(s.atlas))] };
    },
  };
}
