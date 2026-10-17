/**
 * Sprite pipeline: gathers drawables from the ECS (Sprite+Transform, BuildPiece+Transform, optional
 * AnimState), resolves frames through the AtlasManager (one texture array -> one draw call),
 * interpolates PrevTransform->Transform, culls, and writes instances.
 *
 * - Dynamic sprites (characters, zombies, items, resources, ghosts, cut-away pieces): sorted back-to-
 *   front each frame (packed u32 key sort), one instanced draw.
 * - Static build pieces: per-chunk cached instance buffers, rebuilt only when a chunk's checksum
 *   changes; one instanced draw per visible chunk.
 * - Depth: per-vertex iso depth (billboards as vertical planes, Flat pieces on the ground plane) into
 *   the depth buffer, so terrain cliffs, walls and sprites interleave correctly. Multi-tile pieces are
 *   split into per-column slices, each keyed by its front-most footprint tile.
 */
import { entityIndex, lerpAngle, PrevTransform, Transform, type ComponentDef, type World } from "@engine/core";
import { CHUNK_SIZE, chunkKey, type BuildingGrid, type ChunkedSpatialIndex, type IsoConfig } from "@engine/world";
import { createProgram, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import { Sprite, Shadow, Occluder, SpriteFlag, LightSource } from "./components.js";
import { newResolved, type AtlasManager, type ResolvedFrame } from "./assets/atlasManager.js";
import type { Rect } from "./camera.js";
import type { StyleConfig } from "./style.js";
import type { TransformSource } from "./transformSource.js";
import type { VfxLayer } from "./vfx.js";

export const INSTANCE_FLOATS = 28;
const OPEN = 1e5;

/** Gameplay-owned components the renderer reads (schemas as agreed with Survival Systems). */
export type BuildPieceDefT = ComponentDef<{ visualId: "u16"; variant: "u8"; tint: "u32"; damageStage: "u8"; rotation: "u8"; level: "u8"; layer: "u8"; ghost: "u8" }>;
export type AnimStateDefT = ComponentDef<{ state: "u8"; startTick: "u32" }>;
export type WetnessDefT = ComponentDef<{ level: "u8" }>;
export type BodyTempDefT = ComponentDef<{ cold: "u8"; heat: "u8"; shivering: "u8" }>;
/** Gameplay-owned components the renderer reads (injected; render does not depend on gameplay). Emitter/lit come from core. */
export interface GameplayBindings {
  buildPiece?: BuildPieceDefT; animState?: AnimStateDefT;
  /** Wetness {level u8 0..255} (art's 0-3 intensity maps onto 0..255). */
  wetness?: WetnessDefT;
  /** BodyTemp {cold, heat u8; shivering 0/1}: shivering gates the shiver, cold scales it and drives the frost rim, heat drives flush. */
  bodyTemp?: BodyTempDefT;
  /** core Emitter {kind, radius, strength, falloff} (kinds mapped by the emitter table). */
  emitter?: ComponentDef;
  /** Fuel/Burning {lit}: an Emitter on an entity with this component only shows while lit != 0. */
  lit?: ComponentDef;
}

const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec4 aA; // sx, sy, key, scale
layout(location=1) in vec4 aB; // entry, flags, seed, alpha
layout(location=2) in vec4 aC; // ax, ay, sliceL, sliceR
layout(location=3) in vec4 aD; // tint rgb, sliceFootDy
layout(location=4) in vec4 aE; // shadowAlpha, ghost, damageOverlay, shadowWidth
layout(location=5) in vec4 aF; // wet 0..1, cold 0..1, shivering 0/1, heat 0..1
layout(location=6) in vec4 aG; // sway amp (px), freq (Hz), stiffness, -
${GLSL_COMMON}
uniform highp sampler2D uFrames;
uniform float uZPerPx, uHH, uTime, uWind, uOutline;
uniform int uShadowPass, uShadowMode;
uniform vec2 uShadowDir; uniform float uBlobAspect; uniform vec2 uWindVec; // screen-x wind direction, strength 0..1
out vec4 vFx; out vec3 vUv; out float vAlpha; flat out int vFlags; flat out vec4 vRect; out vec3 vTint; flat out vec3 vMisc; out vec2 vLocal;
void main() {
  int entry = int(aB.x + 0.5); int flags = int(aB.y + 0.5);
  ivec2 tc = ivec2((entry % 1024) * 2, entry / 1024);
  vec4 uvr = texelFetch(uFrames, tc, 0);
  vec4 dim = texelFetch(uFrames, tc + ivec2(1, 0), 0); // w, h, layer, hasEmissive
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float s = aA.w;
  vFx = aF; vFlags = flags; vRect = uvr; vTint = aD.rgb; vMisc = vec3(aE.y, aE.z, dim.w); vAlpha = aB.w;
  vLocal = c * 2.0 - 1.0;
  if (uShadowPass == 1) {
    if (aE.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vAlpha = aE.x;
    vec2 iso; float key = aA.z + 0.004;
    if (uShadowMode == 0) { // blob
      float hw = dim.x * s * aE.w * 0.5;
      iso = aA.xy + uShadowDir * 6.0 + vLocal * vec2(hw, hw * uBlobAspect);
      vUv = vec3(0.0, 0.0, dim.z);
    } else { // projected silhouette
      float x = c.x * dim.x, y = c.y * dim.y; float flip = (flags & 1) != 0 ? -1.0 : 1.0;
      float px = (x - aC.x) * s * flip, hp = (aC.y - y) * s;
      iso = aA.xy + vec2(px, 0.0) + uShadowDir * hp;
      vUv = vec3(mix(uvr.xy, uvr.zw, vec2(x / dim.x, y / dim.y)), dim.z);
    }
    gl_Position = vec4(isoToClip(iso), keyToNdc(key), 1.0);
    return;
  }
  float ow = (flags & 16) != 0 ? 0.0 : uOutline;
  float x0 = max(-ow, aC.x + aC.z), x1 = min(dim.x + ow, aC.x + aC.w);
  float x = mix(x0, x1, c.x), y = mix(-ow, dim.y + ow, c.y);
  float flip = (flags & 1) != 0 ? -1.0 : 1.0;
  float px = (x - aC.x) * s * flip;
  float hp = (aC.y - y) * s;
  if (aG.x > 0.0) { // wind sway: weight from height above the pivot, global wind + per-instance phase
    float wgt = pow(clamp(hp / max(1.0, aC.y * s), 0.0, 1.0), max(0.25, aG.z));
    px += uWindVec.x * uWindVec.y * aG.x * s * wgt * (0.65 + 0.35 * sin(uTime * aG.y * 6.283 + aB.z * 6.283));
  } else if ((flags & 4) != 0) px += sin(uTime * 1.6 + aB.z * 6.283) * uWind * max(hp, 0.0) * 0.05;
  if (aF.z > 0.5) px += sin(uTime * 52.0 + aB.z * 40.0) * (0.4 + 1.4 * aF.y) * s; // shiver
  vUv = vec3(mix(uvr.xy, uvr.zw, vec2(x / dim.x, y / dim.y)), dim.z);
  vec2 iso = aA.xy + vec2(px, -hp);
  float key = (flags & 8) != 0 ? aA.z + 0.01 - hp / uHH : aA.z + 0.02 + max(hp + aD.w, 0.0) * uZPerPx;
  gl_Position = vec4(isoToClip(iso), keyToNdc(key), 1.0);
}`;

const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec4 vFx; in vec3 vUv; in float vAlpha; flat in int vFlags; flat in vec4 vRect; in vec3 vTint; flat in vec3 vMisc; in vec2 vLocal;
uniform highp sampler2DArray uAtlas, uEmis;
uniform int uShadowPass, uShadowMode;
uniform float uShadowAlpha, uOutline, uTexel, uTime, uEmisStrength, uAlphaMul;
uniform vec4 uOutlineColor; uniform vec3 uShadowColor, uFrostColor, uFlushTint; uniform float uWetDarken, uWetSheen;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
float inRect(vec2 uv) { return step(vRect.x, uv.x) * step(uv.x, vRect.z) * step(vRect.y, uv.y) * step(uv.y, vRect.w); }
float alphaAt(vec2 uv) { return texture(uAtlas, vec3(uv, vUv.z)).a * inRect(uv); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  if (uShadowPass == 1) {
    float a;
    if (uShadowMode == 0) { float d = length(vLocal); a = 1.0 - smoothstep(0.35, 1.0, d); }
    else a = step(0.3, alphaAt(vUv.xy));
    if (a <= 0.01) discard;
    oColor = vec4(uShadowColor, a * uShadowAlpha * vAlpha);
    oEmissive = vec4(0.0);
    return;
  }
  vec4 t = texture(uAtlas, vUv) * inRect(vUv.xy);
  vec3 col = t.rgb * vTint; float a = t.a;
  if (a < 0.5 && uOutline > 0.0 && (vFlags & 16) == 0) {
    float o = 0.0; vec2 d = vec2(uOutline * uTexel);
    o = max(o, alphaAt(vUv.xy + vec2(d.x, 0.0))); o = max(o, alphaAt(vUv.xy - vec2(d.x, 0.0)));
    o = max(o, alphaAt(vUv.xy + vec2(0.0, d.y))); o = max(o, alphaAt(vUv.xy - vec2(0.0, d.y)));
    o = max(o, alphaAt(vUv.xy + d * 0.7071)); o = max(o, alphaAt(vUv.xy - d * 0.7071));
    o = max(o, alphaAt(vUv.xy + vec2(d.x, -d.y) * 0.7071)); o = max(o, alphaAt(vUv.xy + vec2(-d.x, d.y) * 0.7071));
    if (o > 0.5) { col = uOutlineColor.rgb; a = uOutlineColor.a; }
  }
  if (a < 0.35) discard;
  // procedural crack overlay when the atlas has no damage-stage frames
  float dmg = vMisc.y;
  if (dmg > 0.5) {
    vec2 g = vUv.xy / uTexel / 3.0; float n = h21(floor(g));
    float crack = step(1.0 - 0.06 * dmg, n) + step(0.985 - 0.01 * dmg, h21(floor(g * 0.5) + 7.0));
    col *= 1.0 - min(1.0, crack) * 0.55 - 0.08 * dmg;
  }
  // survival FX: wetness (darken + sheen + drips), frost rim (cold), flush (heat)
  if (vFx.x > 0.003) {
    col *= mix(1.0, uWetDarken, vFx.x);
    float sheen = pow(max(0.0, 1.0 - length((vLocal - vec2(-0.35, -0.45)) * vec2(1.2, 0.9))), 3.0);
    vec2 px = vUv.xy / uTexel;
    float drip = step(0.94, h21(vec2(floor(px.x / 2.0), floor((px.y - uTime * 24.0) / 5.0))));
    col += vec3(0.75, 0.85, 1.0) * vFx.x * uWetSheen * (sheen + drip * 0.6) * t.a;
  }
  if (vFx.y > 0.25) {
    float d = uTexel * 1.5; float m = min(min(alphaAt(vUv.xy + vec2(d, 0.0)), alphaAt(vUv.xy - vec2(d, 0.0))), min(alphaAt(vUv.xy + vec2(0.0, d)), alphaAt(vUv.xy - vec2(0.0, d))));
    float f = smoothstep(0.25, 1.0, vFx.y);
    col = mix(col, uFrostColor, f * (1.0 - m) * 0.85 + f * 0.12);
  }
  if (vFx.w > 0.003) col = mix(col, col * uFlushTint, vFx.w);
  float alpha = smoothstep(0.35, 0.75, a) * vAlpha * uAlphaMul;
  int ghost = int(vMisc.x + 0.5);
  if (ghost > 0) {
    vec3 gc = ghost == 1 ? vec3(0.35, 1.0, 0.45) : vec3(1.0, 0.3, 0.3);
    col = mix(col, gc, 0.55); alpha *= 0.5 + 0.18 * sin(uTime * 6.0);
  }
  float e = (vFlags & 2) != 0 ? 1.0 : 0.0;
  if (vMisc.z > 0.5) { vec4 em = texture(uEmis, vUv); e = max(e, max(em.r, max(em.g, em.b)) * em.a); }
  oColor = vec4(col, alpha);
  // r: darkness bypass (emissive); g: bloom source (emissive pixels + light-source sprites)
  oEmissive = vec4(e * uEmisStrength, (vFlags & 32) != 0 ? max(e, 0.6) : e, 0.0, alpha);
}`;

interface StaticChunk { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number; checksum: number; cx: number; cy: number; maxZ: number; seen: number; born: number }

export interface PrepareContext {
  world: World; alpha: number; rect: Rect; atlas: AtlasManager; depthMin: number; depthRange: number;
  tickHz: number; style: StyleConfig; bindings: GameplayBindings;
  spatial?: { index: ChunkedSpatialIndex; activeKeys?: ReadonlySet<string> } | undefined;
  activeKeys?: ReadonlySet<string> | undefined;
  grid?: BuildingGrid | undefined;
  /** world z units per building level */
  levelZ: number;
  /** Where building sprites' pivot sits on the footprint (default "center"). */
  pieceAnchor?: "center" | "front";
  transformSource?: TransformSource | undefined;
  vfx?: VfxLayer | undefined;
  /** renderer clock, seconds (static chunk fade-in, vfx) */
  now: number;
  /** Status particle hook (drips when wet, breath when cold, sweat when hot); called per visible entity with level 0..1. */
  statusFx?: ((kind: "wet" | "cold" | "heat", x: number, y: number, z: number, level: number) => void) | undefined;
}

export class SpriteBatch {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private capacity = 0;
  private inst = new Float32Array(0);
  private tmp = new Float32Array(0);
  private sortKeys = new Uint32Array(0);
  private gpuBytes = 0;
  private n = 0;
  private depthMin = 0; private depthRange = 1;
  private res: ResolvedFrame = newResolved();
  private statics = new Map<string, StaticChunk>();
  private staticScratch = new Map<string, number[]>();
  private frameNo = 0;
  private xf = new Float32Array(4);
  /** Seconds for newly streamed static chunks to fade in (0 = pop). */
  chunkFadeIn = 0.35;
  visible = 0;
  staticInstances = 0; staticChunksDrawn = 0; staticRebuilds = 0;
  focusEntity = -1;
  /** Entities whose pieces are currently cut away (debug/stat). */
  cutawayActive = false;

  constructor(private gl: WebGL2RenderingContext, private iso: IsoConfig, private zFactor: number) {
    this.prog = createProgram(gl, VS, FS, "sprites");
    this.vbo = gl.createBuffer()!;
    this.vao = this.makeVao(this.vbo);
    this.ensure(4096);
  }

  private makeVao(vbo: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl; const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (let a = 0; a < 7; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, a * 16); gl.vertexAttribDivisor(a, 1); }
    gl.bindVertexArray(null);
    return vao;
  }

  private ensure(n: number): void {
    if (n <= this.capacity) return;
    let c = Math.max(this.capacity, 1024); while (c < n) c *= 2;
    c = Math.min(c, 65536);
    const tmp = new Float32Array(c * INSTANCE_FLOATS); tmp.set(this.tmp.subarray(0, Math.min(this.tmp.length, tmp.length)));
    const keys = new Uint32Array(c); keys.set(this.sortKeys.subarray(0, Math.min(this.sortKeys.length, c)));
    this.capacity = c; this.tmp = tmp; this.sortKeys = keys; this.inst = new Float32Array(c * INSTANCE_FLOATS);
  }

  /** Append one dynamic instance. */
  private push(o: Float32Array | number[], src: number): void {
    if (this.n >= this.capacity) { if (this.capacity >= 65536) return; this.ensure(this.n + 1); }
    const d = this.n * INSTANCE_FLOATS; const t = this.tmp;
    for (let q = 0; q < INSTANCE_FLOATS; q++) t[d + q] = o[src + q]!;
    const key = t[d + 2]!;
    const qd = Math.max(0, Math.min(65535, ((key - this.depthMin) / this.depthRange) * 65535)) | 0;
    this.sortKeys[this.n] = ((qd << 16) | this.n) >>> 0;
    this.n++;
  }

  /** screen-x wind direction (-1..1), strength 0..1; set by the renderer each frame. */
  windVec = new Float32Array([1, 0]);
  /** Shadow colour (style.shadowTint or the grading keyframe's). */
  shadowColor = new Float32Array(3);
  private one = new Float32Array(INSTANCE_FLOATS);
  private writeOne(sx: number, sy: number, key: number, scale: number, r: ResolvedFrame, flags: number, seed: number, alpha: number,
    sliceL: number, sliceR: number, tint: number, footDy: number, shadowA: number, ghost: number, dmgOverlay: number, shadowW: number): Float32Array {
    const o = this.one;
    o[0] = sx; o[1] = sy; o[2] = key; o[3] = scale;
    o[4] = r.entry; o[5] = flags; o[6] = seed; o[7] = alpha;
    o[8] = r.ax; o[9] = r.ay; o[10] = sliceL; o[11] = sliceR;
    if (tint === 0) { o[12] = 1; o[13] = 1; o[14] = 1; } else { o[12] = ((tint >>> 24) & 255) / 255; o[13] = ((tint >>> 16) & 255) / 255; o[14] = ((tint >>> 8) & 255) / 255; }
    o[15] = footDy;
    o[16] = shadowA; o[17] = ghost; o[18] = dmgOverlay; o[19] = shadowW;
    o.fill(0, 20, 28);
    return o;
  }

  /** CPU phase: gather, interpolate, resolve, cull, sort. */
  prepare(cx: PrepareContext): void {
    const { world, alpha, rect, atlas } = cx;
    this.frameNo++;
    this.n = 0; this.depthMin = cx.depthMin; this.depthRange = cx.depthRange;
    if (!atlas.registry) { this.visible = 0; return; }
    const sp = world.store(Sprite), tr = world.store(Transform), pv = world.store(PrevTransform);
    const sh = world.store(Shadow), oc = world.store(Occluder), ls = world.store(LightSource);
    const an = cx.bindings.animState ? world.store(cx.bindings.animState) : null;
    const wet = cx.bindings.wetness ? world.store(cx.bindings.wetness) : null;
    const bt = cx.bindings.bodyTemp ? world.store(cx.bindings.bodyTemp) : null;
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, zs = this.iso.zStep, zf = this.zFactor;
    const margin = 256;
    const r0x = rect.x0 - margin, r1x = rect.x1 + margin, r0y = rect.y0 - margin * 0.5, r1y = rect.y1 + margin * 2;
    const tx = tr.data.x, ty = tr.data.y, tz = tr.data.z, tf = tr.data.facing;
    const px = pv.data.x, py = pv.data.y, pz = pv.data.z, pf = pv.data.facing;
    const tickTime = world.tick - 1 + alpha;
    const res = this.res;
    const blobW = cx.style.blobShadow.widthFactor;
    const src = cx.transformSource; const xf = this.xf;

    // focus (local player) for occluder fading + cutaway
    let fx = 1e9, fy = 1e9, fk = -1e9, fwx = 0, fwy = 0, fwz = 0, hasFocus = false;
    if (this.focusEntity >= 0 && world.isAlive(this.focusEntity)) {
      const fi = entityIndex(this.focusEntity); const ts = tr.slot(fi);
      if (ts >= 0) {
        const ps = pv.slot(fi);
        fwx = ps >= 0 ? px[ps]! + (tx[ts]! - px[ps]!) * alpha : tx[ts]!;
        fwy = ps >= 0 ? py[ps]! + (ty[ts]! - py[ps]!) * alpha : ty[ts]!;
        fwz = ps >= 0 ? pz[ps]! + (tz[ts]! - pz[ps]!) * alpha : tz[ts]!;
        if (cx.transformSource?.entities.has(this.focusEntity) && cx.transformSource.sample(world, this.focusEntity, alpha, this.xf)) { fwx = this.xf[0]!; fwy = this.xf[1]!; fwz = this.xf[2]!; }
        fx = (fwx - fwy) * hw; fy = (fwx + fwy) * hh - fwz * zs - 20; fk = fwx + fwy + fwz * zf; hasFocus = true;
      }
    }

    // ---- dynamic Sprite entities ----
    const emitSprite = (k: number): void => {
      const e = sp.dense[k]!; const i = entityIndex(e);
      const ts = tr.slot(i); if (ts < 0) return;
      const ps = pv.slot(i);
      let x = tx[ts]!, y = ty[ts]!, z = tz[ts]!, f = tf[ts]!;
      if (src && src.entities.has(e) && src.sample(world, e, alpha, xf)) { x = xf[0]!; y = xf[1]!; z = xf[2]!; f = xf[3]!; }
      else if (ps >= 0) { x = px[ps]! + (x - px[ps]!) * alpha; y = py[ps]! + (y - py[ps]!) * alpha; z = pz[ps]! + (z - pz[ps]!) * alpha; f = lerpAngle(pf[ps]!, f, alpha); }
      const sx = (x - y) * hw, sy = (x + y) * hh - z * zs;
      if (sx < r0x || sx > r1x || sy < r0y || sy > r1y) return;
      const sid = sp.data.spriteId[k]!;
      let ok: boolean;
      const as = an ? an.slot(i) : -1;
      if (as >= 0 && an) {
        const st = an.data.state[as]!; const t = (tickTime - an.data.startTick[as]!) / cx.tickHz;
        ok = atlas.resolve(sid, atlas.stateAnim(sid, st), f, t, 0, res);
      } else ok = atlas.resolve(sid, -1, f, 0, sp.data.frameId[k]!, res);
      if (!ok) return;
      const scale = sp.data.scale[k]! || 1;
      const key = x + y + z * zf;
      let fade = 1;
      const os = oc.slot(i);
      if (os >= 0 && hasFocus && key > fk + 0.3) {
        const left = sx - res.ax * scale, top = sy - res.ay * scale;
        if (fx > left && fx < left + res.w * scale && fy > top && fy < sy) fade = oc.data.fade[os]!;
      }
      const ss = sh.slot(i);
      const o0 = this.writeOne(sx, sy, key, scale, res, sp.data.flags[k]! | (ls.slot(i) >= 0 ? SpriteFlag.BloomSource : 0), (i * 0.618034) % 1, fade, -OPEN, OPEN, sp.data.tint[k]! >>> 0, 0,
        ss >= 0 ? sh.data.alpha[ss]! : 0, 0, 0, ss >= 0 ? blobW * (sh.data.length[ss]! || 1) : 0);
      if (wet) { const s2 = wet.slot(i); if (s2 >= 0) { o0[20] = wet.data.level[s2]! / 255; if (o0[20] > 0.3) cx.statusFx?.("wet", x, y, z, o0[20]); } }
      if (bt) { const s2 = bt.slot(i); if (s2 >= 0) { o0[21] = bt.data.cold[s2]! / 255; o0[22] = bt.data.shivering[s2]! ? 1 : 0; o0[23] = (bt.data.heat[s2]! / 255) * cx.style.fx.flushStrength;
        if (o0[22]) cx.statusFx?.("cold", x, y, z, o0[21]); else if (bt.data.heat[s2]! > 150) cx.statusFx?.("heat", x, y, z, bt.data.heat[s2]! / 255); } }
      const sw = atlas.swayOf(sid);
      if (sw) { o0[24] = sw[0]!; o0[25] = sw[1]!; o0[26] = sw[2]!; }
      this.push(o0, 0);
    };
    if (cx.spatial) {
      // chunk-level culling through the shared spatial index
      const keys = visibleChunkKeys(rect, hw, hh, zs, 16);
      for (const ck of keys) {
        if (cx.spatial.activeKeys && !cx.spatial.activeKeys.has(ck)) continue;
        for (const e of cx.spatial.index.entitiesInChunk(ck)) { const s = sp.slot(entityIndex(e)); if (s >= 0) emitSprite(s); }
      }
    } else for (let k = 0; k < sp.size; k++) emitSprite(k);

    // ---- VFX (render-side, short-lived) ----
    if (cx.vfx) for (const v of cx.vfx.active) {
      const sx = (v.x - v.y) * hw, sy = (v.x + v.y) * hh - v.z * zs;
      if (sx < r0x || sx > r1x || sy < r0y || sy > r1y) continue;
      if (!atlas.resolve(v.spriteId, v.anim, v.facing, cx.now - v.born, 0, res)) continue;
      const fadeOut = Math.min(1, (v.lifetime - (cx.now - v.born)) / 0.15);
      this.push(this.writeOne(sx, sy, v.x + v.y + v.z * zf + 0.05, v.scale, res, (v.emissive ? SpriteFlag.Emissive : 0) | SpriteFlag.NoOutline, 0, fadeOut, -OPEN, OPEN, 0, 0, 0, 0, 0, 0), 0);
    }

    // ---- build pieces ----
    this.staticInstances = 0;
    const bpDef = cx.bindings.buildPiece;
    if (bpDef) this.gatherPieces(cx, world.store(bpDef), hasFocus, fwx, fwy, fwz);

    // ---- sort ----
    const n = this.n; const sorted = this.sortKeys.subarray(0, n); sorted.sort();
    const inst = this.inst, tmp = this.tmp;
    for (let j = 0; j < n; j++) {
      const src = (sorted[j]! & 0xffff) * INSTANCE_FLOATS, dst = j * INSTANCE_FLOATS;
      for (let q = 0; q < INSTANCE_FLOATS; q++) inst[dst + q] = tmp[src + q]!;
    }
    this.visible = n;
  }

  private gatherPieces(cx: PrepareContext, bp: ReturnType<World["store"]>, hasFocus: boolean, fwx: number, fwy: number, fwz: number): void {
    const { world, atlas, rect } = cx; const tr = world.store(Transform);
    const d = bp.data as Record<string, ArrayLike<number>>;
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, zs = this.iso.zStep, zf = this.zFactor;
    const res = this.res; const levelZ = cx.levelZ;
    // cutaway region from BuildingGrid: tiles of the building the focus entity stands in
    const playerLevel = hasFocus ? Math.max(0, Math.floor((fwz + 0.01) / levelZ)) : 0;
    const cut = hasFocus && cx.grid ? cutawayRegion(cx.grid, Math.floor(fwx), Math.floor(fwy), playerLevel) : null;
    this.cutawayActive = !!cut;
    const scratch = this.staticScratch; for (const v of scratch.values()) v.length = 0;
    const checksums = new Map<string, number>();
    const tmp: number[] = [];
    for (let k = 0; k < bp.size; k++) {
      const e = bp.dense[k]!; const i = entityIndex(e); const ts = tr.slot(i); if (ts < 0) continue;
      const vis = d.visualId![k]!; const rot = d.rotation![k]! & 3; const level = d.level![k]!; const layer = d.layer![k]!;
      const ghost = d.ghost![k]!; const dmg = d.damageStage![k]!; const tint = d.tint![k]! >>> 0;
      if (!atlas.resolvePiece(vis, d.variant![k]!, rot, dmg, res)) continue;
      const info = atlas.pieceInfo(vis);
      const fw = info ? (rot & 1 ? info.fh : info.fw) : 1, fh = info ? (rot & 1 ? info.fw : info.fh) : 1;
      const ax = Math.floor(tr.data.x[ts]!), ay = Math.floor(tr.data.y[ts]!);
      const z = tr.data.z[ts]! + level * levelZ;
      const cutaway = !!cut && (layer === 3 || level > playerLevel) && footprintHits(cut, ax, ay, fw, fh);
      const dynamic = ghost > 0 || cutaway;
      const alpha = cutaway ? cx.style.cutawayAlpha : 1;
      // footprint far corner (fx, fy); sprite pivot = footprint centre on the ground (art guide / sample manifest)
      // or the front-most footprint corner (cx.pieceAnchor === "front")
      const fx = ax + fw, fy = ay + fh;
      const pvx = cx.pieceAnchor === "front" ? fx : ax + fw / 2, pvy = cx.pieceAnchor === "front" ? fy : ay + fh / 2;
      const sx = (pvx - pvy) * hw, sy = (pvx + pvy) * hh - z * zs;
      const flat = layer === 0 || info?.layer === 0; // floors, and roofs drawn with floor-type (flat) sprites
      const flags = flat ? SpriteFlag.Flat : 0;
      const dmgOverlay = dmg > 0 && !res.hasDamageFrames ? dmg : 0;
      const bias = layer * 0.01;
      tmp.length = 0;
      // per-column slices: columns c = x - y over the footprint
      const cMin = ax - (fy - 1), cMax = (fx - 1) - ay;
      const single = flat || cMin === cMax;
      for (let c = cMin; c <= cMax; c++) {
        // front-most tile in column c: maximise x+y with x-y=c inside footprint
        let best = -1e9;
        for (let tyy = ay; tyy < fy; tyy++) { const txx = c + tyy; if (txx >= ax && txx < fx) best = Math.max(best, txx + tyy); }
        // depth anchor: the front-most tile's centre (front-corner pivot) or its front corner (centre pivot, whose
        // pixels extend down to that corner and must not be clipped by the terrain in front of the pivot)
        const front = cx.pieceAnchor === "front" ? 1 : 1.95;
        const key = (single ? fx + fy - 2 + front : best + front) + z * zf + bias;
        const colCenter = c * hw - sx; // relative to pivot (px)
        const sliceL = single || c === cMin ? -OPEN : colCenter - hw / 2;
        const sliceR = single || c === cMax ? OPEN : colCenter + hw / 2;
        // slice foot = screen y of the front corner of its front-most tile, relative to pivot
        const footDy = single ? 0 : (best + 2) * hh - z * zs - sy;
        const o = this.writeOne(sx, sy, key, 1, res, flags, (i * 0.618034) % 1, alpha, sliceL, sliceR, tint, footDy, 0, ghost, dmgOverlay, 0);
        for (let q = 0; q < INSTANCE_FLOATS; q++) tmp.push(o[q]!);
        if (single) break;
      }
      if (dynamic) {
        if (sx < rect.x0 - 512 || sx > rect.x1 + 512 || sy < rect.y0 - 256 || sy > rect.y1 + 1024) continue;
        for (let j = 0; j < tmp.length; j += INSTANCE_FLOATS) this.push(tmp, j);
      } else {
        const ck = chunkKey(Math.floor(ax / CHUNK_SIZE), Math.floor(ay / CHUNK_SIZE));
        let list = scratch.get(ck); if (!list) scratch.set(ck, (list = []));
        for (const v of tmp) list.push(v);
        let h = checksums.get(ck) ?? 0x811c9dc5;
        for (let j = 0; j < tmp.length; j += 3) h = Math.imul(h ^ Math.round(tmp[j]! * 64), 16777619) >>> 0;
        checksums.set(ck, h);
      }
    }
    // rebuild changed static chunks, drop empty ones
    for (const [ck, list] of scratch) {
      const sum = (checksums.get(ck) ?? 0) ^ list.length;
      let sc = this.statics.get(ck);
      if (list.length === 0) { if (sc) { this.gl.deleteBuffer(sc.vbo); this.gl.deleteVertexArray(sc.vao); this.statics.delete(ck); } scratch.delete(ck); continue; }
      if (!sc || sc.checksum !== sum) {
        const gl = this.gl;
        if (!sc) { const vbo = gl.createBuffer()!; const [cxs, cys] = ck.split(",").map(Number) as [number, number]; sc = { vbo, vao: this.makeVao(vbo), count: 0, checksum: 0, cx: cxs, cy: cys, maxZ: 0, seen: 0, born: cx.now }; this.statics.set(ck, sc); }
        // sort within chunk back-to-front for nicer edge blending
        const cnt = list.length / INSTANCE_FLOATS; const order = Array.from({ length: cnt }, (_, j) => j).sort((a, b) => list[a * INSTANCE_FLOATS + 2]! - list[b * INSTANCE_FLOATS + 2]!);
        const buf = new Float32Array(list.length); let maxZ = 0;
        order.forEach((j, o) => { for (let q = 0; q < INSTANCE_FLOATS; q++) buf[o * INSTANCE_FLOATS + q] = list[j * INSTANCE_FLOATS + q]!; });
        for (let j = 0; j < cnt; j++) maxZ = Math.max(maxZ, -(buf[j * INSTANCE_FLOATS + 1]! - 0));
        gl.bindBuffer(gl.ARRAY_BUFFER, sc.vbo); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
        sc.count = cnt; sc.checksum = sum; sc.maxZ = maxZ; this.staticRebuilds++;
      }
      sc.seen = this.frameNo;
      this.staticInstances += sc.count;
    }
    for (const [ck, sc] of this.statics) if (sc.seen !== this.frameNo) { this.gl.deleteBuffer(sc.vbo); this.gl.deleteVertexArray(sc.vao); this.statics.delete(ck); }
  }

  upload(): void {
    if (this.visible === 0) return;
    const gl = this.gl; const bytes = this.visible * INSTANCE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (bytes > this.gpuBytes) { this.gpuBytes = this.capacity * INSTANCE_FLOATS * 4; gl.bufferData(gl.ARRAY_BUFFER, this.gpuBytes, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, this.visible * INSTANCE_FLOATS);
  }

  private setup(pass: "shadow" | "sprite", u: Program["u"], view: Float32Array, depth: Float32Array, atlas: AtlasManager, time: number, wind: number,
    shadowDir: readonly [number, number], shadowAlpha: number, style: StyleConfig): void {
    const gl = this.gl;
    gl.useProgram(this.prog.prog);
    gl.uniform4fv(u.uView!, view); gl.uniform2fv(u.uDepth!, depth);
    gl.uniform1f(u.uZPerPx!, this.zFactor / this.iso.zStep); gl.uniform1f(u.uHH!, this.iso.tileH / 2);
    gl.uniform1f(u.uTime!, time); gl.uniform1f(u.uWind!, wind);
    gl.uniform2fv(u.uWindVec!, this.windVec); gl.uniform3fv(u.uShadowColor!, this.shadowColor);
    gl.uniform3fv(u.uFrostColor!, style.fx.frostColor); gl.uniform3fv(u.uFlushTint!, style.fx.flushTint);
    gl.uniform1f(u.uWetDarken!, style.fx.wetDarken); gl.uniform1f(u.uWetSheen!, style.fx.wetSheen);
    gl.uniform1i(u.uShadowPass!, pass === "shadow" ? 1 : 0);
    gl.uniform1i(u.uShadowMode!, style.shadowMode === "blob" ? 0 : 1);
    gl.uniform1f(u.uBlobAspect!, style.blobShadow.aspect);
    gl.uniform2f(u.uShadowDir!, shadowDir[0], shadowDir[1]); gl.uniform1f(u.uShadowAlpha!, shadowAlpha);
    gl.uniform1f(u.uOutline!, style.outline.enabled ? style.outline.widthPx : 0);
    gl.uniform4fv(u.uOutlineColor!, style.outline.color);
    gl.uniform1f(u.uAlphaMul!, 1); gl.uniform1f(u.uTexel!, 1 / atlas.layerSize); gl.uniform1f(u.uEmisStrength!, style.emissiveStrength);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.tex); gl.uniform1i(u.uAtlas!, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas.frameTex); gl.uniform1i(u.uFrames!, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.emisTex); gl.uniform1i(u.uEmis!, 2);
  }

  /** Static (cached) build-piece chunks: opaque, depth-written, one draw per visible chunk. */
  drawStatic(view: Float32Array, depth: Float32Array, atlas: AtlasManager, time: number, now: number, rect: Rect, activeKeys: ReadonlySet<string> | undefined, style: StyleConfig, stats: FrameStats): void {
    if (!atlas.tex || this.statics.size === 0) { this.staticChunksDrawn = 0; return; }
    const gl = this.gl; const { u } = this.prog;
    this.setup("sprite", u, view, depth, atlas, time, 0, [0, 0], 0, style);
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, S = CHUNK_SIZE; let drawn = 0;
    for (const [ck, sc] of this.statics) {
      if (activeKeys && !activeKeys.has(ck)) continue;
      const x0 = sc.cx * S, y0 = sc.cy * S;
      const sxMin = (x0 - (y0 + S)) * hw - 128, sxMax = (x0 + S - y0) * hw + 128;
      const syMin = (x0 + y0) * hh - 1024, syMax = (x0 + y0 + 2 * S) * hh + 64;
      if (sxMax < rect.x0 || sxMin > rect.x1 || syMax < rect.y0 || syMin > rect.y1) continue;
      gl.uniform1f(u.uAlphaMul!, this.chunkFadeIn > 0 ? Math.min(1, (now - sc.born) / this.chunkFadeIn) : 1);
      gl.bindVertexArray(sc.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sc.count);
      stats.drawCalls++; drawn++;
    }
    gl.bindVertexArray(null);
    gl.uniform1f(u.uAlphaMul!, 1);
    this.staticChunksDrawn = drawn;
  }

  draw(pass: "shadow" | "sprite", view: Float32Array, depth: Float32Array, atlas: AtlasManager, time: number, wind: number,
    shadowDir: readonly [number, number], shadowAlpha: number, style: StyleConfig, stats: FrameStats): void {
    if (this.visible === 0 || !atlas.tex) return;
    if (pass === "shadow" && (shadowAlpha <= 0 || style.shadowMode === "none")) return;
    const gl = this.gl; const { u } = this.prog;
    this.setup(pass, u, view, depth, atlas, time, wind, shadowDir, shadowAlpha, style);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visible);
    gl.bindVertexArray(null);
    stats.drawCalls++;
    if (pass === "sprite") stats.sprites = this.visible + this.staticInstances;
  }
}

/** Chunk keys whose tiles may project into the iso rect (tile box from inverted rect corners). */
export function visibleChunkKeys(rect: Rect, hw: number, hh: number, zs: number, maxZ: number): string[] {
  const a0 = rect.x0 / hw, a1 = rect.x1 / hw; // x - y
  const b0 = rect.y0 / hh, b1 = (rect.y1 + maxZ * zs) / hh; // x + y
  const xMin = Math.floor((a0 + b0) / 2) - 2, xMax = Math.ceil((a1 + b1) / 2) + 2;
  const yMin = Math.floor((b0 - a1) / 2) - 2, yMax = Math.ceil((b1 - a0) / 2) + 2;
  const out: string[] = [];
  for (let cy = Math.floor(yMin / CHUNK_SIZE); cy <= Math.floor(yMax / CHUNK_SIZE); cy++)
    for (let cx = Math.floor(xMin / CHUNK_SIZE); cx <= Math.floor(xMax / CHUNK_SIZE); cx++) {
      // reject chunks whose diamond misses the rect horizontally/vertically
      const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE, S = CHUNK_SIZE;
      if ((x0 + S - y0) * hw < rect.x0 - hw || (x0 - y0 - S) * hw > rect.x1 + hw) continue;
      if ((x0 + y0 + 2 * S) * hh < rect.y0 || (x0 + y0) * hh - maxZ * zs > rect.y1 + hh) continue;
      out.push(chunkKey(cx, cy));
    }
  return out;
}

/** Set of packed tile keys ("x,y") forming the building the focus stands in, or null when not under a roof/upper floor. */
export function cutawayRegion(grid: BuildingGrid, tx: number, ty: number, level: number, maxTiles = 600): Set<string> | null {
  const covered = (x: number, y: number): boolean => {
    for (let lv = level + 1; lv < 16; lv++) if (grid.at(x, y, lv) !== 0) return true;
    return grid.at(x, y, level, 3) !== 0;
  };
  if (!covered(tx, ty)) return null;
  const inside = (x: number, y: number): boolean => covered(x, y) || grid.at(x, y, level, 0) !== 0;
  const seen = new Set<string>(); const q: [number, number][] = [[tx, ty]]; seen.add(`${tx},${ty}`);
  while (q.length && seen.size < maxTiles) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && inside(nx, ny)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}

function footprintHits(region: Set<string>, ax: number, ay: number, fw: number, fh: number): boolean {
  for (let y = ay - 1; y <= ay + fh; y++) for (let x = ax - 1; x <= ax + fw; x++) if (region.has(`${x},${y}`)) return true;
  return false;
}
