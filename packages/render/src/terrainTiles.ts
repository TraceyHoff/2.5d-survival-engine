/**
 * Textured terrain: Art & Assets' tile atlas (64x48 cells = 64x32 top diamond + 16 px camera-facing skirt) drawn as
 * chunk-cached instanced sprites on top of the vertex-colour terrain mesh (which still provides cliff faces for
 * drops > 1 level and fills AA seams). Animated tiles (water, shore) animate by frame offset in the shader.
 * Shore tiles are chosen from the 4/8-neighbourhood (TERRAIN rules below). Ground-plane depth like flat decals.
 * Surface overlays (wet ground, puddles, snow cover) are applied on top in the same shader.
 */
import { CHUNK_SIZE, WaterDepth, waterDepthAt, type TileMap, type Chunk, type IsoConfig } from "@engine/world";
import { createProgram, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import type { AtlasManager } from "./assets/atlasManager.js";
import type { Rect } from "./camera.js";
import { TileId, TERRAIN_SPRITES, SHORE_SPRITES, isWaterTile } from "./ids.js";
import type { SurfaceState, SurfaceProvider } from "./tilemap.js";

const FLOATS = 12;
const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec4 aA; // x, y, z, entry
layout(location=1) in vec4 aB; // count, fps, skirtMask (1 = +x side, 2 = +y side), phase
layout(location=2) in vec4 aC; // ax, ay, water, -
${GLSL_COMMON}
uniform highp sampler2D uFrames;
uniform vec3 uIso; uniform float uZFactor, uTime;
out vec3 vUvRaw; flat out int vLayer; flat out vec4 vRect; out vec2 vLocal; out vec2 vWorld; flat out vec4 vInfo; // vInfo: w, h, skirtMask, water
void main() {
  int frames = max(1, int(aB.x + 0.5));
  int entry = int(aA.w + 0.5) + int(mod(floor(uTime * aB.y + aB.w), float(frames)));
  ivec2 tc = ivec2((entry % 1024) * 2, entry / 1024);
  vec4 uvr = texelFetch(uFrames, tc, 0); vec4 dim = texelFetch(uFrames, tc + ivec2(1, 0), 0);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = c * dim.xy; // frame px
  vUvRaw = vec3(mix(uvr.xy, uvr.zw, c), dim.z); vLayer = int(dim.z + 0.5); vRect = uvr; vLocal = px; vInfo = vec4(dim.xy, aB.z, aC.z);
  vec2 pivot = vec2((aA.x - aA.y) * uIso.x, (aA.x + aA.y) * uIso.y - aA.z * uIso.z); // tile centre
  vec2 iso = pivot + px - aC.xy;
  // world position (for overlays) of the ground point under this pixel
  vec2 d = (px - aC.xy) / uIso.xy; vWorld = vec2(aA.x, aA.y) + vec2(d.x + d.y, d.y - d.x) * 0.5;
  float hp = aC.y - px.y; // px above pivot
  float key = aA.x + aA.y + aA.z * uZFactor + 0.004 - max(hp, -uIso.y) / uIso.y; // ground plane; skirt clamped to the front corner
  gl_Position = vec4(isoToClip(iso), keyToNdc(key), 1.0);
}`;
const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec3 vUvRaw; flat in int vLayer; flat in vec4 vRect; in vec2 vLocal; in vec2 vWorld; flat in vec4 vInfo;
uniform highp sampler2DArray uAtlas;
#define vUv vec3(vUvRaw.xy, float(vLayer)) // flat int array layer (no interpolated layer index)
uniform vec3 uIso; uniform float uTime, uWet, uSnow, uPuddles, uWetDarken; uniform vec3 uSkyRefl;
layout(location=0) out vec4 oColor; layout(location=1) out vec4 oEmissive;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 uv = clamp(vUv.xy, vRect.xy, vRect.zw);
  vec4 t = texture(uAtlas, vec3(uv, vUv.z));
  if (t.a < 0.5) discard;
  // skirt pixels (below the diamond): keep only on sides whose neighbour is lower
  float tw = uIso.x * 2.0, th = uIso.y * 2.0;
  vec2 q = vLocal - vec2(uIso.x, uIso.y);
  bool inDiamond = abs(q.x) / uIso.x + abs(q.y) / uIso.y <= 1.02;
  int mask = int(vInfo.z + 0.5);
  if (!inDiamond && q.y > 0.0) { bool right = q.x > 0.0; if (right ? (mask & 1) == 0 : (mask & 2) == 0) discard; }
  vec3 c = t.rgb;
  if (inDiamond && vInfo.w < 0.5) {
    float m = vnoise(vWorld * 0.9) * 0.65 + vnoise(vWorld * 3.1 + 11.0) * 0.35;
    if (uWet > 0.001) {
      c *= mix(1.0, uWetDarken, uWet);
      float pud = smoothstep(1.0 - 0.45 * uWet * uPuddles, 1.04 - 0.45 * uWet * uPuddles, m);
      float ripple = 0.5 + 0.5 * sin(length(fract(vWorld * 2.0) - 0.5) * 40.0 - uTime * 8.0);
      c = mix(c, uSkyRefl * (0.85 + 0.15 * ripple), pud * 0.65);
    }
    if (uSnow > 0.001) {
      float cover = smoothstep(1.0 - uSnow, 1.0 - uSnow + 0.15, m * 0.6 + 0.2 * h21(floor(vWorld * 6.0)) + 0.2);
      c = mix(c, vec3(0.9, 0.93, 0.98) * (0.94 + 0.06 * h21(floor(vWorld * 16.0))), cover);
    }
  }
  oColor = vec4(c, 1.0); oEmissive = vec4(0.0);
}`;

interface TileChunk { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number; stamp: number; cx: number; cy: number; maxZ: number; minZ: number; atlasVersion: number }

export class TileTerrain {
  private prog: Program;
  private chunks = new Map<Chunk, TileChunk>();
  constructor(private gl: WebGL2RenderingContext, private iso: IsoConfig, private zFactor: number) { this.prog = createProgram(gl, VS, FS, "terrain-tiles"); }

  /** True when the registry has at least the base terrain sprites. */
  static available(atlas: AtlasManager): boolean {
    const reg = atlas.registry; if (!reg) return false;
    return reg.ids.sprites.tryId("tile_grass") !== undefined && reg.ids.sprites.tryId("tile_water") !== undefined && atlas.animEntries(reg.ids.sprites.id("tile_grass"))!.h >= 32;
  }

  private stamp(map: TileMap, c: Chunk): number {
    let s = c.version;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const n = map.getChunk(c.cx + dx, c.cy + dy); s = (Math.imul(s, 31) + (n ? n.version + 1 : 0)) | 0; }
    return s;
  }

  private build(map: TileMap, c: Chunk, atlas: AtlasManager, old?: TileChunk): TileChunk {
    const gl = this.gl; const reg = atlas.registry!;
    const ent = new Map<string, ReturnType<AtlasManager["animEntries"]>>();
    const E = (key: string): ReturnType<AtlasManager["animEntries"]> => {
      if (!ent.has(key)) { const id = reg.ids.sprites.tryId(key); ent.set(key, id === undefined ? null : atlas.animEntries(id)); }
      return ent.get(key)!;
    };
    const tileAt = (x: number, y: number): number => map.getTile(x, y);
    const hAt = (x: number, y: number): number => { const ch = map.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)); if (!ch) return -99; const i = (((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE) * CHUNK_SIZE + (((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE); return ch.tiles[i] === 0 ? -99 : ch.height[i]! - (isWaterTile(ch.tiles[i]!) ? 0.25 : 0); };
    const data: number[] = []; let minZ = 1e9, maxZ = -1e9;
    const ox = c.cx * CHUNK_SIZE, oy = c.cy * CHUNK_SIZE;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const i = ly * CHUNK_SIZE + lx; const id = c.tiles[i]!; if (id === 0) continue;
      const x = ox + lx, y = oy + ly; const water = isWaterTile(id);
      const z = c.height[i]! - (water ? 0.25 : 0);
      let key: string | undefined;
      if (!water && (id === TileId.Sand)) {
        const w = (dx: number, dy: number): boolean => isWaterTile(tileAt(x + dx, y + dy));
        if (w(0, -1)) key = SHORE_SPRITES.n; else if (w(1, 0)) key = SHORE_SPRITES.e; else if (w(0, 1)) key = SHORE_SPRITES.s; else if (w(-1, 0)) key = SHORE_SPRITES.w;
        else if (w(1, -1)) key = SHORE_SPRITES.ne; else if (w(1, 1)) key = SHORE_SPRITES.se; else if (w(-1, 1)) key = SHORE_SPRITES.sw; else if (w(-1, -1)) key = SHORE_SPRITES.nw;
      }
      const shallow = id === TileId.Water && waterDepthAt(tileAt, x, y) === WaterDepth.Shallow; // ADR-181: shore band uses the shallow-water art
      const variants = (shallow ? TERRAIN_SPRITES[TileId.ShallowWater] : undefined) ?? TERRAIN_SPRITES[id] ?? TERRAIN_SPRITES[TileId.Dirt]!;
      const hsh = ((Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0) % 997;
      let e = key ? E(key) : null;
      if (!e) e = E(variants[hsh % variants.length]!) ?? E(variants[0]!);
      if (!e) continue;
      const mask = (hAt(x + 1, y) < z ? 1 : 0) | (hAt(x, y + 1) < z ? 2 : 0);
      data.push(x + 0.5, y + 0.5, z, e.first, e.count, e.fps, mask, 0, e.ax, e.ay, water ? 1 : 0, 0);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const vao = old?.vao ?? gl.createVertexArray()!; const vbo = old?.vbo ?? gl.createBuffer()!;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    for (let a = 0; a < 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, FLOATS * 4, a * 16); gl.vertexAttribDivisor(a, 1); }
    gl.bindVertexArray(null);
    return { vao, vbo, count: data.length / FLOATS, stamp: this.stamp(map, c), cx: c.cx, cy: c.cy, minZ, maxZ, atlasVersion: atlas.version };
  }

  draw(map: TileMap, atlas: AtlasManager, view: Float32Array, depth: Float32Array, rect: Rect, time: number, stats: FrameStats,
    surface: SurfaceState, perChunk: SurfaceProvider | undefined, sstyle: { puddles: number; wetDarken: number; skyRefl: readonly number[] }, activeKeys?: ReadonlySet<string>): void {
    if (!atlas.tex || !atlas.frameTex) return;
    const gl = this.gl; const { u } = this.prog; const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, S = CHUNK_SIZE;
    gl.useProgram(this.prog.prog);
    gl.uniform4fv(u.uView ?? null, view); gl.uniform2fv(u.uDepth ?? null, depth);
    gl.uniform3f(u.uIso ?? null, hw, hh, this.iso.zStep); gl.uniform1f(u.uZFactor ?? null, this.zFactor); gl.uniform1f(u.uTime ?? null, time);
    gl.uniform1f(u.uPuddles ?? null, sstyle.puddles); gl.uniform1f(u.uWetDarken ?? null, sstyle.wetDarken);
    gl.uniform3f(u.uSkyRefl ?? null, sstyle.skyRefl[0]!, sstyle.skyRefl[1]!, sstyle.skyRefl[2]!);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.tex); gl.uniform1i(u.uAtlas ?? null, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas.frameTex); gl.uniform1i(u.uFrames ?? null, 1);
    for (const c of map.loadedChunks()) {
      if (activeKeys && !activeKeys.has(c.key)) continue;
      const x0 = c.cx * S, y0 = c.cy * S;
      const sxMin = (x0 - (y0 + S)) * hw - hw, sxMax = (x0 + S - y0) * hw + hw;
      const syMin = (x0 + y0) * hh - 16 * this.iso.zStep, syMax = (x0 + y0 + 2 * S) * hh + 2 * hh;
      if (sxMax < rect.x0 || sxMin > rect.x1 || syMax < rect.y0 || syMin > rect.y1) continue;
      let t = this.chunks.get(c);
      if (!t || t.stamp !== this.stamp(map, c) || t.atlasVersion !== atlas.version) { t = this.build(map, c, atlas, t); this.chunks.set(c, t); }
      if (!t.count) continue;
      const sf = perChunk?.(c.key) ?? surface;
      gl.uniform1f(u.uWet ?? null, sf.wet); gl.uniform1f(u.uSnow ?? null, sf.snow);
      gl.bindVertexArray(t.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, t.count); stats.drawCalls++;
    }
    gl.bindVertexArray(null);
    for (const [c, t] of this.chunks) if (map.getChunk(c.cx, c.cy) !== c) { gl.deleteBuffer(t.vbo); gl.deleteVertexArray(t.vao); this.chunks.delete(c); }
  }
}
