/**
 * Terrain renderer for @engine/world's chunked TileMap: one static mesh (VAO) per 32x32 chunk,
 * with top faces plus cliff faces wherever a neighbour is lower (all four sides since ADR-253: the vertex shader
 * collapses the two facing away from the current view rotation and shades the two facing it).
 * Meshes are rebuilt only when a chunk's `version` (or a neighbour's) changes. Chunks outside
 * the camera rect are culled (one draw call per visible chunk).
 */
import { CHUNK_SIZE, VIEW_COS, VIEW_SIN, viewRect, tileToChunk, tileToLocal, renderTileHeight, waterCornerTint, type TileMap, type Chunk, type IsoConfig } from "@engine/world";
import { SEASON_GROUND_GLSL } from "./season.js";
import { createProgram, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import type { Rect } from "./camera.js";
import { TileId, isWaterTile } from "./ids.js";

/** Height of tile (tx,ty) or -1 when the tile is missing/empty. */
export function tileHeight(map: TileMap, tx: number, ty: number): number {
  const c = map.getChunk(tileToChunk(tx), tileToChunk(ty));
  if (!c) return -1;
  const i = tileToLocal(ty) * CHUNK_SIZE + tileToLocal(tx);
  return c.tiles[i] === 0 ? -1 : renderTileHeight(c.tiles[i]!, c.height[i]!); // ADR-182: water is one flat level
}

// Base palette (sRGB 0..255) per TileId: Art & Assets palette.json base tones (used under/without the tile atlas).
const PALETTE: Record<number, [number, number, number]> = {
  [TileId.Water]: [0x34, 0x84, 0xbc], [TileId.ShallowWater]: [0x4a, 0x9c, 0xc8], [TileId.Sand]: [0xf6, 0xdf, 0xa4], [TileId.Grass]: [0x8f, 0xd1, 0x5c],
  [TileId.Dirt]: [0xc0, 0x8a, 0x5a], [TileId.Stone]: [0xb8, 0xb2, 0xb0], [TileId.Snow]: [0xee, 0xf4, 0xfb], [TileId.Forest]: [0x6f, 0xa8, 0x4a], [TileId.Mud]: [0x7a, 0x5c, 0x3e], // mud: ADR-246
};
const SHALLOW_RGB = [0x41, 0xb5, 0xcc] as const, DEEP_RGB = [0x18, 0x46, 0x90] as const; // ADR-184: turquoise shore -> deep blue (ADR-253: shallow #41b5cc, same as Canvas2D C2D_SHALLOW)
/** ADR-253 cliff face flags (aColor.a): face normal +x, +y, -x, -y. */
export const CLIFF_PX = 2, CLIFF_PY = 3, CLIFF_NX = 4, CLIFF_NY = 5;
/** Cliff face shade by its normal in view space: +u (screen lower-right) 0.62, +v (screen lower-left) 0.8, else hidden (0). */
export function cliffShade(flag: number, view: number): number {
  const n = [[1, 0], [0, 1], [-1, 0], [0, -1]][flag - CLIFF_PX]; if (!n) return 0;
  const k = view & 3, c = VIEW_COS[k]!, s = VIEW_SIN[k]!; const u = c * n[0]! - s * n[1]!, v = s * n[0]! + c * n[1]!;
  return u > 0.5 ? 0.62 : v > 0.5 ? 0.8 : 0;
}
const SIDE: Record<number, [number, number, number]> = {
  [TileId.Grass]: [112, 84, 56], [TileId.Sand]: [168, 140, 92], [TileId.Water]: [38, 92, 140],
};

const hash = (x: number, y: number): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 aPos;     // world x, y, z (tile units / levels)
layout(location=1) in vec4 aColor;   // rgb + flags (a*255: 1 = water)
${GLSL_COMMON}
uniform vec3 uIso; // tileW/2, tileH/2, zStep
uniform float uZFactor;
uniform vec2 uRot; // ADR-253 view rotation (cos, sin) of the quarter turn: world (x, y) -> view (u, v)
out vec3 vColor; out vec2 vWorld; flat out int vFlags;
void main() {
  vec2 w = vec2(uRot.x * aPos.x - uRot.y * aPos.y, uRot.y * aPos.x + uRot.x * aPos.y);
  vec2 iso = vec2((w.x - w.y) * uIso.x, (w.x + w.y) * uIso.y - aPos.z * uIso.z);
  float key = w.x + w.y + aPos.z * uZFactor;
  int fl = int(aColor.a * 255.0 + 0.5); vColor = aColor.rgb; vWorld = aPos.xy;
  if (fl >= 2) { // ADR-253 cliff face: shade by its view-space normal; faces turned away collapse to a point (no fragments)
    vec2 n = fl == 2 ? vec2(1, 0) : fl == 3 ? vec2(0, 1) : fl == 4 ? vec2(-1, 0) : vec2(0, -1);
    vec2 nv = vec2(uRot.x * n.x - uRot.y * n.y, uRot.y * n.x + uRot.x * n.y);
    float sh = nv.x > 0.5 ? 0.62 : nv.y > 0.5 ? 0.8 : 0.0;
    if (sh == 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vFlags = 2; return; }
    vColor *= sh; fl = 2;
  }
  gl_Position = vec4(isoToClip(iso), keyToNdc(key), 1.0);
  vFlags = fl;
}`;

const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec3 vColor; in vec2 vWorld; flat in int vFlags;
uniform float uTime, uWet, uSnow, uPuddles, uWetDarken, uIce;
uniform vec3 uSkyRefl, uSeason;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
${SEASON_GROUND_GLSL}
void main() {
  vec3 c = vColor;
  if (vFlags == 1) {
    // animated water: two travelling wave bands + sparkle
    float w = sin(vWorld.x * 2.3 + uTime * 1.3) * sin(vWorld.y * 1.7 - uTime * 0.9);
    float w2 = sin((vWorld.x + vWorld.y) * 4.0 + uTime * 2.1);
    c *= 0.9 + 0.12 * w + 0.05 * w2;
    float sp = step(0.985, h21(floor(vWorld * 10.0) + floor(uTime * 3.0)));
    c += sp * 0.25;
    c = seasonIce(c, vWorld, uIce, 0.5); // ADR-239 winter ice
  } else if (vFlags != 2) {
    // top-face texture speckle (cheap procedural detail)
    float n = h21(floor(vWorld * 8.0));
    c *= 0.92 + 0.16 * n;
  }
  if (vFlags != 1) c = seasonGround(c, vWorld, uSeason); // ADR-239
  if (vFlags != 1) {
    // surface overlays (procedural fallback for the 64x32 overlay tiles): wet ground, puddles, snow cover
    float m = vnoise(vWorld * 0.9) * 0.65 + vnoise(vWorld * 3.1 + 11.0) * 0.35;
    if (uWet > 0.001) {
      c *= mix(1.0, uWetDarken, uWet);
      float pud = smoothstep(1.0 - 0.45 * uWet * uPuddles, 1.04 - 0.45 * uWet * uPuddles, m) * float(vFlags == 0);
      float ripple = 0.5 + 0.5 * sin(length(fract(vWorld * 2.0) - 0.5) * 40.0 - uTime * 8.0);
      c = mix(c, uSkyRefl * (0.85 + 0.15 * ripple), pud * 0.65);
    }
    if (vFlags == 0) c = seasonSnow(c, vWorld, m, max(uSnow, uSeason.z)); // weather snow + ADR-239 snowpack
  }
  oColor = vec4(c, 1.0);
  oEmissive = vec4(0.0);
}`;

export interface SurfaceState { wet: number; snow: number }
export type SurfaceProvider = (chunkKey: string) => SurfaceState | undefined;

interface ChunkMesh { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number; stamp: number; minZ: number; maxZ: number; cx: number; cy: number }

export class TilemapRenderer {
  private prog: Program;
  private meshes = new Map<Chunk, ChunkMesh>();
  maxZ = 1;

  constructor(private gl: WebGL2RenderingContext, private iso: IsoConfig, private zFactor: number) {
    this.prog = createProgram(gl, VS, FS, "tilemap");
  }

  /** Combined version stamp of a chunk and the 4 neighbours whose heights affect its cliff faces (ADR-253: all sides). */
  private stamp(map: TileMap, c: Chunk): number {
    const v = (d: Chunk | undefined): number => (d ? d.version + 1 : 0);
    const a = map.getChunk(c.cx + 1, c.cy), b = map.getChunk(c.cx, c.cy + 1), a2 = map.getChunk(c.cx - 1, c.cy), b2 = map.getChunk(c.cx, c.cy - 1);
    return (((c.version * 1009 + v(a)) * 1013 + v(b)) * 1019 + v(a2)) * 1021 + v(b2);
  }

  private build(map: TileMap, c: Chunk, old?: ChunkMesh): ChunkMesh {
    const gl = this.gl;
    const verts: number[] = []; const cols: number[] = []; const idx: number[] = [];
    let minZ = 1e9, maxZ = -1e9;
    const quad = (p: number[][], r: number, g: number, b: number, flag: number): void => {
      const base = verts.length / 3;
      for (const v of p) { verts.push(v[0]!, v[1]!, v[2]!); cols.push(r, g, b, flag); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const ox = c.cx * CHUNK_SIZE, oy = c.cy * CHUNK_SIZE; const tg = (a: number, b: number): number => map.getTile(a, b);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const i = ly * CHUNK_SIZE + lx; const id = c.tiles[i]!; if (id === 0) continue;
      const x = ox + lx, y = oy + ly; const z = renderTileHeight(id, c.height[i]!);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      const pal = PALETTE[isWaterTile(id) ? TileId.Water : id] ?? [255, 0, 255];
      const v = 0.94 + hash(x, y) * 0.12;
      const water = isWaterTile(id) ? 1 : 0;
      const zt = water ? z - 0.25 : z;
      if (water) { // ADR-182: shore tint blended per corner (smooth, not stepped) over one flat surface
        const base = verts.length / 3; const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const;
        for (const [qx, qy] of corners) {
          const k = waterCornerTint(tg, qx, qy); verts.push(qx, qy, zt); // ADR-184: shared corners -> continuous gradient
          cols.push(...([0, 1, 2] as const).map((j) => DEEP_RGB[j] + (SHALLOW_RGB[j] - DEEP_RGB[j]) * k), water); // ADR-246: no per-tile brightness jitter on water (a visible diamond grid)
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      } else quad([[x, y, zt], [x + 1, y, zt], [x + 1, y + 1, zt], [x, y + 1, zt]], pal[0] * v, pal[1] * v, pal[2] * v, water);
      // Cliff faces on every side whose neighbour is lower (ADR-253): base side colour, the vertex shader shades the two
      // facing the current view (+u 0.62 / +v 0.8, as the fixed +x / +y faces before) and collapses the other two.
      const side = SIDE[id] ?? pal;
      const low = (nx: number, ny: number): number => { const h = tileHeight(map, nx, ny); return h < 0 ? -1 : h - (tileIsWater(map, nx, ny) ? 0.25 : 0); };
      const bx = low(x + 1, y), by = low(x, y + 1), bnx = low(x - 1, y), bny = low(x, y - 1);
      if (bx < zt) quad([[x + 1, y, zt], [x + 1, y + 1, zt], [x + 1, y + 1, bx], [x + 1, y, bx]], side[0], side[1], side[2], CLIFF_PX);
      if (by < zt) quad([[x, y + 1, zt], [x + 1, y + 1, zt], [x + 1, y + 1, by], [x, y + 1, by]], side[0], side[1], side[2], CLIFF_PY);
      if (bnx < zt) quad([[x, y + 1, zt], [x, y, zt], [x, y, bnx], [x, y + 1, bnx]], side[0], side[1], side[2], CLIFF_NX);
      if (bny < zt) quad([[x + 1, y, zt], [x, y, zt], [x, y, bny], [x + 1, y, bny]], side[0], side[1], side[2], CLIFF_NY);
    }
    const n = verts.length / 3;
    const buf = new ArrayBuffer(n * 16); const f = new Float32Array(buf); const u8 = new Uint8Array(buf);
    for (let k = 0; k < n; k++) {
      f[k * 4] = verts[k * 3]!; f[k * 4 + 1] = verts[k * 3 + 1]!; f[k * 4 + 2] = verts[k * 3 + 2]!;
      for (let j = 0; j < 4; j++) u8[k * 16 + 12 + j] = Math.max(0, Math.min(255, Math.round(cols[k * 4 + j]!)));
    }
    const vao = old?.vao ?? gl.createVertexArray()!; const vbo = old?.vbo ?? gl.createBuffer()!; const ibo = old?.ibo ?? gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: idx.length, stamp: this.stamp(map, c), minZ, maxZ, cx: c.cx, cy: c.cy };
  }

  /** Rebuild stale meshes; returns world-space bounds for the depth range. */
  sync(map: TileMap): { minKey: number; maxKey: number } {
    let minKey = 1e9, maxKey = -1e9;
    for (const c of map.loadedChunks()) {
      let m = this.meshes.get(c);
      if (!m || m.stamp !== this.stamp(map, c)) { m = this.build(map, c, m); this.meshes.set(c, m); }
      const vr = viewRect(c.cx * CHUNK_SIZE, c.cy * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, this.iso.view ?? 0); // ADR-253 view-space keys
      minKey = Math.min(minKey, vr.x + vr.y - 2); maxKey = Math.max(maxKey, vr.x + vr.y + 2 * CHUNK_SIZE + m.maxZ * this.zFactor);
      this.maxZ = Math.max(this.maxZ, m.maxZ);
    }
    for (const [c, m] of this.meshes) if (map.getChunk(c.cx, c.cy) !== c) {
      this.gl.deleteVertexArray(m.vao); this.gl.deleteBuffer(m.vbo); this.gl.deleteBuffer(m.ibo); this.meshes.delete(c);
    }
    return { minKey, maxKey };
  }

  /** Surface state: global (from Weather) unless `perChunk` (gameplay's per-chunk surface value) returns one. */
  surface: SurfaceState = { wet: 0, snow: 0 };
  /** ADR-239: fall, winter, ground snow floor, ice (seasonVisual). */
  season: [number, number, number, number] = [0, 0, 0, 0];
  perChunk: SurfaceProvider | undefined;
  surfaceStyle = { puddles: 1, wetDarken: 0.72, skyRefl: [0.55, 0.62, 0.72] as readonly number[] };

  draw(view: Float32Array, depth: Float32Array, rect: Rect, time: number, stats: FrameStats, activeKeys?: ReadonlySet<string>): void {
    const gl = this.gl; const { u } = this.prog;
    gl.useProgram(this.prog.prog);
    gl.uniform4fv(u.uView!, view); gl.uniform2fv(u.uDepth!, depth);
    gl.uniform3f(u.uIso!, this.iso.tileW / 2, this.iso.tileH / 2, this.iso.zStep);
    gl.uniform1f(u.uZFactor!, this.zFactor); gl.uniform1f(u.uTime!, time);
    const vq = (this.iso.view ?? 0) & 3; gl.uniform2f(u.uRot ?? null, VIEW_COS[vq]!, VIEW_SIN[vq]!);
    gl.uniform1f(u.uPuddles!, this.surfaceStyle.puddles); gl.uniform1f(u.uWetDarken!, this.surfaceStyle.wetDarken);
    gl.uniform3f(u.uSeason ?? null, this.season[0], this.season[1], this.season[2]); gl.uniform1f(u.uIce ?? null, this.season[3]);
    const sr = this.surfaceStyle.skyRefl; gl.uniform3f(u.uSkyRefl!, sr[0]!, sr[1]!, sr[2]!);
    let lastW = -1, lastS = -1;
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, S = CHUNK_SIZE;
    for (const [c, m] of this.meshes) {
      if (m.count === 0) continue;
      if (activeKeys && !activeKeys.has(c.key)) continue;
      // Chunk iso bounds: diamond spanning corners (x0,y0)..(x0+S,y0+S), lifted by z range.
      const vr = viewRect(m.cx * S, m.cy * S, S, S, vq); const x0 = vr.x, y0 = vr.y; // ADR-253: the chunk's view-space square
      const sxMin = (x0 - (y0 + S)) * hw, sxMax = (x0 + S - y0) * hw;
      const syMin = (x0 + y0) * hh - m.maxZ * this.iso.zStep, syMax = (x0 + y0 + 2 * S) * hh - Math.min(0, m.minZ - 1) * this.iso.zStep;
      if (sxMax < rect.x0 || sxMin > rect.x1 || syMax < rect.y0 || syMin > rect.y1) continue;
      const sf = this.perChunk?.(c.key) ?? this.surface;
      if (sf.wet !== lastW) { gl.uniform1f(u.uWet!, (lastW = sf.wet)); } if (sf.snow !== lastS) { gl.uniform1f(u.uSnow!, (lastS = sf.snow)); }
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, m.count / 6 * 4 > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      stats.drawCalls++; stats.chunks++; stats.tiles += S * S;
    }
    gl.bindVertexArray(null);
  }
}

function tileIsWater(map: TileMap, x: number, y: number): boolean { return isWaterTile(map.getTile(x, y)); }
