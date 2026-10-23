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
import { CHUNK_SIZE, chunkKey, floorToTerrainZ, terrainZToFloor, type BuildingGrid, type ChunkedSpatialIndex, type IsoConfig } from "@engine/world";
import { createProgram, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import { Sprite, Shadow, Occluder, SpriteFlag, LightSource, TintSecondary } from "./components.js";
import { newResolved, type AtlasManager, type ResolvedFrame } from "./assets/atlasManager.js";
import type { Rect } from "./camera.js";
import type { StyleConfig } from "./style.js";
import type { TransformSource } from "./transformSource.js";
import type { VfxLayer } from "./vfx.js";
import { LayerCache, activeExpression, readAppearanceSlot, type AppearanceBinding, type CachedLayer } from "./character/layers.js";

export const INSTANCE_FLOATS = 36;
/** Depth offset of held items vs the body (must exceed depth-key precision; < the next tile row). */
export const HELD_BIAS = 0.05;
const OPEN = 1e5;
/** Depth-key step between a character's paper-doll layers (10 layers < HELD_BIAS; far below one tile = 1.0). */
export const LAYER_BIAS = 0.001;
/** Render-internal instance flag (above the u8 SpriteFlag range): draw only the outline ring of this frame. */
export const OUTLINE_ONLY = 256;

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
  /** gameplay Burning {lit, intensity 0-255, startTick} on build pieces: fire/ember/smoke VFX (see burning.ts). */
  burning?: ComponentDef<{ lit: "u8"; intensity: "u8"; startTick: "u32" }>;
  /** gameplay Equipment {mainHandItem u16 (0 = empty)}: the item is drawn at the character frame's hand anchor (frameMeta handR via AssetRegistry.anchorPoint; legacy hands.json fallback). */
  equipment?: ComponentDef<{ mainHandItem: "u16" }>;
  /** Item id -> held sprite id (`held_<item key>` in the `held` atlas); undefined = draw nothing. */
  heldSprite?: (itemId: number) => number | undefined;
  /** Exhaustion {level u8 0..255}: drives the `exhausted` status tint (SpriteDef.tints / render_tuning). */
  exhausted?: ComponentDef<{ level: "u8" }>;
  /** core Emitter {kind, radius, strength, falloff} (kinds mapped by the emitter table). */
  emitter?: ComponentDef;
  /** Fuel/Burning {lit}: an Emitter on an entity with this component only shows while lit != 0. */
  lit?: ComponentDef;
  /** Night-only emissive art (stall lanterns): atlas-emissive pixels of these sprites are multiplied by `gate` (StallLayer: 0 by day, flicker at night). */
  nightEmissive?: { readonly sprites: ReadonlySet<number>; gate: number };
  /** Per build-piece [primary, secondary] RGBA8 tint override (clan palette for tintmask R/G); undefined = BuildPiece.tint, no secondary. */
  pieceTints?: (entity: number) => readonly [number, number] | undefined;
  /** Per build-piece state index override (e.g. stall closed/open from StallHeader.open); undefined = BuildPiece.state. */
  pieceState?: (entity: number) => number | undefined;
  /** core Appearance + resolveLayers (character customization): entities with Appearance draw their resolved layers. */
  appearance?: AppearanceBinding;
  /** Hit flash 0..1 per entity (white flash on the body and all its layers); undefined/0 = none. */
  hitFlash?: (entity: number) => number;
}

const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec4 aA; // sx, sy, key, scale
layout(location=1) in vec4 aB; // entry, flags, seed, alpha
layout(location=2) in vec4 aC; // ax, ay, sliceL, sliceR
layout(location=3) in vec4 aD; // tint rgb, sliceFootDy
layout(location=4) in vec4 aE; // shadowAlpha, ghost, damageOverlay, shadowWidth
layout(location=5) in vec4 aF; // wet 0..1, cold 0..1, shivering 0/1, heat 0..1
layout(location=6) in vec4 aG; // sway amp (px), freq (Hz), stiffness, occlusion 0..1
layout(location=7) in vec4 aH; // secondary tint rgb (tintmask G; 0 = none), exhausted 0..1
layout(location=8) in vec4 aI; // rotation (radians, screen, around the pivot; held items), unused x3
${GLSL_COMMON}
uniform highp sampler2D uFrames;
uniform float uZPerPx, uHH, uTime, uWind, uOutline;
uniform int uShadowPass, uShadowMode;
uniform vec2 uShadowDir; uniform float uBlobAspect; uniform vec2 uWindVec; // screen-x wind direction, strength 0..1
out vec4 vFx; out vec3 vUv; out float vAlpha; flat out int vFlags; flat out vec4 vRect; out vec3 vTint; flat out vec3 vMisc; out vec2 vLocal; out vec2 vScr; flat out float vOcc; flat out ivec2 vFB; flat out vec4 vTint2; flat out float vSwayPx; flat out vec4 vLT;
void main() {
  int entry = int(aB.x + 0.5); int flags = int(aB.y + 0.5);
  ivec2 tc = ivec2((entry % 1024) * 2, entry / 1024);
  vec4 uvr = texelFetch(uFrames, tc, 0);
  vec4 dim = texelFetch(uFrames, tc + ivec2(1, 0), 0); // w, h, layer, hasEmissive
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float s = aA.w;
  vFx = aF; vFlags = flags; vRect = uvr; vTint = aD.rgb; int fw = int(dim.w + 0.5); vFB = ivec2(fw & 15, fw >> 4); vMisc = vec3(aE.y, aE.z, float(fw & 1)); vAlpha = aB.w;
  vTint2 = aH; vSwayPx = 0.0; vLT = aI;
  vLocal = c * 2.0 - 1.0; vOcc = aG.w; vScr = aA.xy;
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
  // slice bounds are screen-relative to the pivot; for mirrored sprites map them back into frame space
  vec2 sl = (flags & 1) != 0 ? vec2(-aC.w, -aC.z) : aC.zw;
  bool maskSway = (vFB.x & 4) != 0 && aG.x > 0.0; float m = maskSway ? aG.x + 1.0 : 0.0; // sway mask: per-pixel UV shift, quad grows by amp
  float x0 = max(-ow - m, aC.x + sl.x), x1 = min(dim.x + ow + m, aC.x + sl.y);
  float x = mix(x0, x1, c.x), y = mix(-ow, dim.y + ow, c.y);
  float flip = (flags & 1) != 0 ? -1.0 : 1.0;
  float px = (x - aC.x) * s * flip;
  float hp = (aC.y - y) * s;
  if (maskSway) vSwayPx = uWindVec.x * uWindVec.y * aG.x * (0.65 + 0.35 * sin(uTime * aG.y * 6.283 + aB.z * 6.283)) * flip * (uvr.z - uvr.x) / dim.x;
  else if (aG.x > 0.0) { // wind sway: weight from height above the pivot, global wind + per-instance phase
    float wgt = pow(clamp(hp / max(1.0, aC.y * s), 0.0, 1.0), 1.0 + 2.0 * clamp(aG.z, 0.0, 1.0)); // stiffness 0..1, higher = stiffer
    px += uWindVec.x * uWindVec.y * aG.x * s * wgt * (0.65 + 0.35 * sin(uTime * aG.y * 6.283 + aB.z * 6.283));
  } else if ((flags & 4) != 0) px += sin(uTime * 1.6 + aB.z * 6.283) * uWind * max(hp, 0.0) * 0.05;
  if (aF.z > 0.5) px += sin(uTime * 52.0 + aB.z * 40.0) * (0.4 + 1.4 * aF.y) * s; // shiver
  vUv = vec3(mix(uvr.xy, uvr.zw, vec2(x / dim.x, y / dim.y)), dim.z);
  vec2 off = vec2(px, -hp);
  if (aI.x != 0.0) { float cr = cos(aI.x), sr = sin(aI.x); off = vec2(cr * off.x - sr * off.y, sr * off.x + cr * off.y); }
  vec2 iso = aA.xy + off; vScr = iso;
  float key = (flags & 8) != 0 ? aA.z + 0.01 - hp / uHH : aA.z + 0.02 + max(hp + aD.w, 0.0) * uZPerPx;
  gl_Position = vec4(isoToClip(iso), keyToNdc(key), 1.0);
}`;

const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec4 vFx; in vec3 vUv; in float vAlpha; flat in int vFlags; flat in vec4 vRect; in vec3 vTint; flat in vec3 vMisc; in vec2 vLocal; in vec2 vScr; flat in float vOcc; flat in ivec2 vFB; flat in vec4 vTint2; flat in float vSwayPx; flat in vec4 vLT;
uniform highp sampler2DArray uAtlas, uEmis, uSheenM, uSwayM, uTintM; uniform highp sampler2D uTints;
uniform int uShadowPass, uShadowMode;
uniform float uShadowAlpha, uOutline, uTexel, uTime, uEmisStrength, uAlphaMul, uNightGate;
uniform vec4 uOutlineColor; uniform vec3 uShadowColor, uFrostColor, uFlushTint; uniform float uWetDarken, uWetSheen;
uniform int uOccMode, uSilhouette; uniform float uOccAlpha, uOccRadius; uniform vec2 uFocusScr; uniform vec4 uSilColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
float inRect(vec2 uv) { return step(vRect.x, uv.x) * step(uv.x, vRect.z) * step(vRect.y, uv.y) * step(uv.y, vRect.w); }
float alphaAt(vec2 uv) { return texture(uAtlas, vec3(uv, vUv.z)).a * inRect(uv); }
// status tint row (AtlasManager tint table: per sprite SpriteDef.tints, row 0 = render_tuning globals)
vec3 statusTint(vec3 c, int idx, float amount) {
  if (amount <= 0.003) return c;
  vec4 a = texelFetch(uTints, ivec2(idx * 2, vFB.y), 0), b = texelFetch(uTints, ivec2(idx * 2 + 1, vFB.y), 0);
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, mix(1.0, b.y, amount));
  float k = a.w * amount; int mode = int(b.x + 0.5);
  vec3 r = mode == 0 ? c * a.rgb : mode == 1 ? c + a.rgb : mode == 2 ? 1.0 - (1.0 - c) * (1.0 - a.rgb) : a.rgb;
  return mix(c, r, k);
}
// character layer tint (resolveLayers, ADR-082 pinned contract). tc arrives pre-divided by tintNeutral for multiply/lerp
// (CPU side), so multiply is exactly out = base * mix(1, color / tintNeutral, strength * mask): a tintNeutral grey pixel
// becomes color at full strength. No pre-saturation; tintSaturation adjusts the tinted result afterwards.
vec3 layerTint(vec3 c, vec3 tc, int mode, float k, float sat) {
  if (k <= 0.003) return c;
  vec3 r = mode == 0 ? c * mix(vec3(1.0), tc, k) : mode == 1 ? mix(c, c + tc, k) : mode == 2 ? mix(c, 1.0 - (1.0 - c) * (1.0 - tc), k)
    : mix(c, tc * dot(c, vec3(0.299, 0.587, 0.114)), k);
  r = clamp(r, 0.0, 1.0);
  return sat == 1.0 ? r : clamp(mix(vec3(dot(r, vec3(0.299, 0.587, 0.114))), r, mix(1.0, sat, k)), 0.0, 1.0);
}
float ringAt(vec2 uv) {
  float o = 0.0; vec2 d = vec2(uOutline * uTexel);
  o = max(o, alphaAt(uv + vec2(d.x, 0.0))); o = max(o, alphaAt(uv - vec2(d.x, 0.0)));
  o = max(o, alphaAt(uv + vec2(0.0, d.y))); o = max(o, alphaAt(uv - vec2(0.0, d.y)));
  o = max(o, alphaAt(uv + d * 0.7071)); o = max(o, alphaAt(uv - d * 0.7071));
  o = max(o, alphaAt(uv + vec2(d.x, -d.y) * 0.7071)); o = max(o, alphaAt(uv + vec2(-d.x, d.y) * 0.7071));
  return o;
}
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
  vec3 uv = vUv;
  if ((vFB.x & 4) != 0 && vSwayPx != 0.0) { // sway mask (R = weight): sample the source shifted against the wind
    float w = texture(uSwayM, vUv).r; uv.x -= vSwayPx * w; // vSwayPx is in uv units
  }
  vec4 t = texture(uAtlas, uv) * inRect(uv.xy);
  if (uSilhouette == 1) { // focus drawn through occluders (depth GREATER)
    if (t.a < 0.35) discard;
    oColor = uSilColor; oEmissive = vec4(0.8, 0.0, 0.0, uSilColor.a); return;
  }
  if ((vFlags & 256) != 0) { // outline-only pass of a character layer (drawn just behind the body: union silhouette outline)
    if (t.a >= 0.5 || uOutline <= 0.0 || ringAt(vUv.xy) <= 0.5) discard;
    float oa = uOutlineColor.a * vAlpha * uAlphaMul * (uOccMode == 0 ? mix(1.0, uOccAlpha, vOcc) : 1.0);
    oColor = vec4(uOutlineColor.rgb, oa); oEmissive = vec4(0.0, 0.0, 0.0, oa); return;
  }
  vec3 col; float a = t.a;
  if (vLT.y > 0.5) { // character layer: tintmask R <- primary (vTint), G <- secondary (vTint2); no mask = whole frame primary
    vec4 tm = (vFB.x & 8) != 0 ? texture(uTintM, uv) : vec4(1.0, 0.0, 0.0, 1.0); int mode = int(vLT.y - 0.5);
    col = layerTint(t.rgb, vTint, mode, vLT.z * tm.r, vLT.w);
    if (dot(vTint2.rgb, vec3(1.0)) > 0.0) col = layerTint(col, vTint2.rgb, mode, vLT.z * tm.g, vLT.w);
  } else if ((vFB.x & 8) != 0) { // two-tone tint mask: R = primary (Sprite.tint), G = secondary (aH rgb)
    vec4 tm = texture(uTintM, uv); vec3 t2 = dot(vTint2.rgb, vec3(1.0)) > 0.0 ? vTint2.rgb : vTint;
    col = t.rgb * mix(vec3(1.0), vTint, tm.r) * mix(vec3(1.0), t2, tm.g);
  } else col = t.rgb * vTint;
  if (a < 0.5 && uOutline > 0.0 && (vFlags & 16) == 0) {
    if (ringAt(vUv.xy) > 0.5) { col = uOutlineColor.rgb; a = uOutlineColor.a; }
  }
  if (a < 0.35) discard;
  if (vOcc > 0.001 && uOccMode == 1) { // dithered circle cut around the focus
    float d = length((vScr - uFocusScr) * vec2(1.0, 1.15)) / uOccRadius;
    ivec2 p = ivec2(gl_FragCoord.xy) & 3;
    if ((1.0 - smoothstep(0.6, 1.0, d)) * vOcc * 1.02 > (BAYER[p.y * 4 + p.x] + 0.5) / 16.0) discard;
  }
  // procedural crack overlay when the atlas has no damage-stage frames
  float dmg = vMisc.y;
  if (dmg > 0.5) {
    vec2 g = vUv.xy / uTexel / 3.0; float n = h21(floor(g));
    float crack = step(1.0 - 0.06 * dmg, n) + step(0.985 - 0.01 * dmg, h21(floor(g * 0.5) + 7.0));
    col *= 1.0 - min(1.0, crack) * 0.55 - 0.08 * dmg;
  }
  // survival FX: wetness (darken + sheen + drips), frost rim (cold), flush (heat)
  if (vFx.x > 0.003) {
    vec4 sm = (vFB.x & 2) != 0 ? texture(uSheenM, uv) : vec4(-1.0); // sheen mask: R sheen, G darken, B drip
    col *= mix(1.0, uWetDarken, vFx.x * (sm.g >= 0.0 ? sm.g : 1.0));
    float sheen = sm.r >= 0.0 ? sm.r : pow(max(0.0, 1.0 - length((vLocal - vec2(-0.35, -0.45)) * vec2(1.2, 0.9))), 3.0);
    vec2 px = vUv.xy / uTexel;
    float drip = step(0.94, h21(vec2(floor(px.x / 2.0), floor((px.y - uTime * 24.0) / 5.0)))) * (sm.b >= 0.0 ? step(0.5, sm.b) : 1.0);
    col += vec3(0.75, 0.85, 1.0) * vFx.x * uWetSheen * (sheen + drip * 0.6) * t.a;
  }
  if (vFx.y > 0.25) {
    float d = uTexel * 1.5; float m = min(min(alphaAt(vUv.xy + vec2(d, 0.0)), alphaAt(vUv.xy - vec2(d, 0.0))), min(alphaAt(vUv.xy + vec2(0.0, d)), alphaAt(vUv.xy - vec2(0.0, d))));
    float f = smoothstep(0.25, 1.0, vFx.y);
    col = mix(col, uFrostColor, f * (1.0 - m) * 0.85 + f * 0.12);
  }
  if (vFx.w > 0.003) col = mix(col, col * uFlushTint, vFx.w);
  // typed status tints (wet, frost, flush, exhausted) with mode + saturation, scaled by the status amount
  col = statusTint(col, 0, vFx.x); col = statusTint(col, 1, vFx.y); col = statusTint(col, 2, vFx.w); col = statusTint(col, 3, vTint2.w);
  if (dmg < -0.001) col = mix(col, vec3(1.0), -dmg); // hit flash (dynamic sprites store -flash in the damage slot)
  float alpha = smoothstep(0.35, 0.75, a) * vAlpha * uAlphaMul;
  if (uOccMode == 0) alpha *= mix(1.0, uOccAlpha, vOcc);
  int ghost = int(vMisc.x + 0.5);
  if (ghost > 0) {
    vec3 gc = ghost == 1 ? vec3(0.35, 1.0, 0.45) : vec3(1.0, 0.3, 0.3);
    col = mix(col, gc, 0.55); alpha *= 0.5 + 0.18 * sin(uTime * 6.0);
  }
  float e = (vFlags & 2) != 0 ? 1.0 : 0.0;
  if (vMisc.z > 0.5) { vec4 em = texture(uEmis, vUv); e = max(e, max(em.r, max(em.g, em.b)) * em.a * ((vFlags & 64) != 0 ? uNightGate : 1.0)); } // 64: night-only emissive
  oColor = vec4(col, alpha);
  // r: darkness bypass (emissive); g: bloom source (emissive pixels + light-source sprites)
  oEmissive = vec4(e * uEmisStrength, (vFlags & 32) != 0 ? max(e, 0.6) : e, 0.0, alpha);
}`;

/** Secondary tint (RGBA8 packed) into instance floats 28..30 (0 = reuse primary). */
export function writeTint2(o: Float32Array, t: number): void { if (t === 0) { o[28] = o[29] = o[30] = 0; return; } o[28] = ((t >>> 24) & 255) / 255 || 1e-3; o[29] = ((t >>> 16) & 255) / 255; o[30] = ((t >>> 8) & 255) / 255; }

interface StaticChunk { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number; checksum: number; cx: number; cy: number; maxZ: number; seen: number; born: number }

export interface PrepareContext {
  world: World; alpha: number; rect: Rect; atlas: AtlasManager; depthMin: number; depthRange: number;
  tickHz: number; style: StyleConfig; bindings: GameplayBindings;
  spatial?: { index: ChunkedSpatialIndex; activeKeys?: ReadonlySet<string> } | undefined;
  activeKeys?: ReadonlySet<string> | undefined;
  grid?: BuildingGrid | undefined;
  /** Terrain height under a tile (for the focus' floor index); 0 when unknown. */
  groundZAt?: ((tx: number, ty: number) => number) | undefined;
  /** Where building sprites' pivot sits on the footprint (default "center"). */
  pieceAnchor?: "center" | "front";
  transformSource?: TransformSource | undefined;
  vfx?: VfxLayer | undefined;
  /** renderer clock, seconds (static chunk fade-in, vfx) */
  now: number;
  /** Camera zoom (character crowd LOD). */
  zoom?: number;
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
  /** occlusion fade state per entity index (smoothed 0..1) */
  private occT = new Float32Array(1024); private occLast = -1;
  private silVbo: WebGLBuffer | null = null; private silVao: WebGLVertexArrayObject | null = null;
  private silInst = new Float32Array(INSTANCE_FLOATS); private silOn = false;
  private focusScr: [number, number] = [0, 0];
  private occ: { occAmount: (i: number, hit: boolean) => number; overlapsFocus: (l: number, r: number, t: number, b: number) => boolean; occOn: boolean; fk: number } =
    { occAmount: () => 0, overlapsFocus: () => false, occOn: false, fk: 0 };
  /** Character layer cache (per entity; re-resolved on Appearance change or facing bucket change). */
  layerCache: LayerCache | null = null;
  /** Character layers: outline mode ("union" = one outline around body+layers, "body" = body only); crowd LOD zoom. */
  characterOpts = { outline: "union" as "union" | "body", minorLayerMinZoom: 0.75 };
  /** Per-frame stats: characters with Appearance drawn, extra layer instances pushed. */
  characters = 0; layerInstances = 0;
  private layerRes = newResolved();
  /** Entities whose pieces are currently cut away (debug/stat). */
  cutawayActive = false;
  /** Night-only emissive gate (GameplayBindings.nightEmissive.gate), latched in prepare. */
  nightGate = 1;

  constructor(private gl: WebGL2RenderingContext, private iso: IsoConfig, private zFactor: number) {
    this.prog = createProgram(gl, VS, FS, "sprites");
    this.vbo = gl.createBuffer()!;
    this.vao = this.makeVao(this.vbo);
    this.ensure(4096);
  }

  private makeVao(vbo: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl; const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    for (let a = 0; a < 9; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, a * 16); gl.vertexAttribDivisor(a, 1); }
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
  /**
   * Faded occluders (fade mode, occlusion > 0.5) go to a separate late batch drawn after the focus silhouette with
   * depth writes off, so the silhouette only shows behind occluders that are still opaque.
   */
  private late: number[] = []; private lateVbo: WebGLBuffer | null = null; private lateVao: WebGLVertexArrayObject | null = null; private lateCount = 0;
  private pushOcc(o: Float32Array | number[], src: number, occT: number, mode: "fade" | "dither"): void {
    if (mode === "fade" && occT > 0.5) { for (let q = 0; q < INSTANCE_FLOATS; q++) this.late.push(o[src + q]!); }
    else this.push(o, src);
  }
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
    o.fill(0, 20, 36);
    return o;
  }

  private layerBase = new Float32Array(INSTANCE_FLOATS);
  /** Layer tint: primary -> rgb 12..14, secondary -> 28..30, mode+1 / strength / saturation -> 33..35. multiply / lerp
   *  colours are divided by the layer's tintNeutral here (see layerTint). */
  private writeLayerTint(o: Float32Array, l: CachedLayer): void {
    const t = l.tint; const d = l.mode === 0 || l.mode === 3 ? 1 / l.neutral : 1;
    if (t === 0) { o[12] = o[13] = o[14] = 1; } else { o[12] = ((t >>> 24) & 255) / 255 * d; o[13] = ((t >>> 16) & 255) / 255 * d; o[14] = ((t >>> 8) & 255) / 255 * d; }
    writeTint2(o, l.tint2);
    if (l.tint2 !== 0 && d !== 1) { o[28] = o[28]! * d; o[29] = o[29]! * d; o[30] = o[30]! * d; }
    o[33] = t === 0 && l.tint2 === 0 ? 0 : l.mode + 1; o[34] = l.strength; o[35] = l.saturation;
  }
  private heldRes = newResolved();
  /** debug: held items [with item, with hand anchor, drawn] since start */
  readonly heldStats: [number, number, number] = [0, 0, 0];
  /**
   * Held item: pivot (grip) at the hand anchor of the character's current frame, rotated by the anchor angle, sorted just
   * behind / in front of the character, mirrored with the character's flipX. No anchor for the frame = not drawn.
   */
  private emitHeld(atlas: AtlasManager, heldOf: (item: number) => number | undefined, item: number, body: ResolvedFrame, sx: number, sy: number, key: number,
    scale: number, facing: number, flip: boolean, fade: number, occT: number, mode: "fade" | "dither"): void {
    if (!item) return; const hid = heldOf(item); if (hid === undefined) return; this.heldStats[0]++;
    const h = atlas.handOf(body); if (!h) return; this.heldStats[1]++;
    const r = this.heldRes; if (!atlas.resolve(hid, 0, facing, 0, 0, r)) return; this.heldStats[2]++;
    const m = flip ? -1 : 1;
    const hx = sx + (h.x - body.ax) * scale * m, hy = sy + (h.y - body.ay) * scale;
    const o = this.writeOne(hx, hy, key + (h.behind ? -HELD_BIAS : HELD_BIAS), scale, r, (flip ? SpriteFlag.FlipX : 0) | SpriteFlag.NoOutline, 0, fade, -OPEN, OPEN, 0, 0, 0, 0, 0, 0);
    // anchor (pivot) height above the body pivot keeps the item's depth on the body's column
    o[15] = (body.ay - h.y) * scale; o[32] = (h.angle * Math.PI / 180) * m; o[27] = occT;
    this.pushOcc(o, 0, occT, mode);
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
    const exh = cx.bindings.exhausted ? world.store(cx.bindings.exhausted) : null;
    const eq = cx.bindings.equipment ? world.store(cx.bindings.equipment) : null; const heldOf = cx.bindings.heldSprite;
    const t2s = world.isRegistered(TintSecondary) ? world.store(TintSecondary) : null;
    const apB = cx.bindings.appearance; const ap0 = apB && world.isRegistered(apB.def) ? world.store(apB.def) : null; const ap = ap0 && (ap0.data as Record<string, unknown>).version ? ap0 : null;
    atlas.beginFrame();
    if (apB && (!this.layerCache || this.layerCache.binding !== apB)) {
      this.layerCache?.clear();
      const lc = (this.layerCache = new LayerCache(apB));
      // streamed wearable pages are refcounted by the cached layer sets (released on change / prune)
      lc.onLayers = (prev, next) => { if (next) for (const l of next) atlas.retainSprite(l.sprite); if (prev) for (const l of prev) atlas.releaseSprite(l.sprite); };
    }
    const apData = ap ? ap.data as Record<string, ArrayLike<number>> : null; const apLen = ap ? (ap as unknown as { lengths: Record<string, number> }).lengths : {};
    const apVer = apData?.version ?? null;
    const lodMinor = (cx.zoom ?? 1) < this.characterOpts.minorLayerMinZoom; const hitOf = cx.bindings.hitFlash;
    const outlineOn = cx.style.outline.enabled && this.characterOpts.outline === "union";
    this.characters = 0; this.layerInstances = 0;
    if (this.layerCache && (this.frameNo & 255) === 0) this.layerCache.prune((e) => world.isAlive(e));
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
    // focus screen rect (from its current frame; fallback 32x56) for the occlusion test
    const occ = cx.style.occlusion; const occOn = occ.enabled && hasFocus;
    let fl = 0, fr = 0, ft = 0, fb = 0;
    if (occOn) {
      const fsl = sp.slot(entityIndex(this.focusEntity));
      const ok = fsl >= 0 && atlas.resolve(sp.data.spriteId[fsl]!, -1, 0, 0, sp.data.frameId[fsl]!, res);
      const sc = fsl >= 0 ? sp.data.scale[fsl]! || 1 : 1;
      const w = ok ? res.w * sc : 32, h = ok ? res.h * sc : 56, ax = ok ? res.ax * sc : 16, ay = ok ? res.ay * sc : 56;
      const sx0 = (fwx - fwy) * hw, sy0 = (fwx + fwy) * hh - fwz * zs;
      fl = sx0 - ax + w * 0.2; fr = sx0 - ax + w * 0.8; ft = sy0 - ay + h * 0.1; fb = sy0 - ay + h * 0.95;
      this.focusScr = [sx0, sy0 - Math.min(ay, h) * 0.5];
    }
    const dtOcc = this.occLast < 0 ? 1 : Math.min(0.25, Math.max(0, cx.now - this.occLast)); this.occLast = cx.now;
    const occStep = Math.min(1, dtOcc * occ.fadeSpeed);
    /** Smoothed occlusion amount for entity index i given whether it occludes this frame. */
    const occAmount = (i: number, hit: boolean): number => {
      if (i >= this.occT.length) { const n = new Float32Array(Math.max(i + 1, this.occT.length * 2)); n.set(this.occT); this.occT = n; }
      const v = this.occT[i]! + ((hit ? 1 : 0) - this.occT[i]!) * occStep;
      this.occT[i] = v < 0.004 ? 0 : v; return this.occT[i]!;
    };
    /** Screen rect [l, r] x [t, b] of a sprite overlaps the focus rect. */
    const overlapsFocus = (l: number, r: number, t: number, b: number): boolean => occOn && r > fl && l < fr && b > ft && t < fb;
    this.silOn = false; this.late.length = 0;
    this.occ = { occAmount, overlapsFocus, occOn, fk };

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
      let sid = sp.data.spriteId[k]!;
      // character customization: resolved paper-doll layers (cached); the "body" layer replaces Sprite.spriteId
      let layers: CachedLayer[] | null = null; let bodyL: CachedLayer | null = null;
      const aps = ap ? ap.slot(i) : -1;
      if (aps >= 0 && this.layerCache) {
        // key (entity, Appearance.version, facing4); version wraps (u16) so the cache compares it for equality only
        // resolveLayers gets the body's current anim name (face/eyes expressions via faceAnims, ADR-082): the AnimState
        // anim resolved on the body sprite (re-resolved once when the body sprite's anim name differs from the guess)
        const as0 = an ? an.slot(i) : -1; const st0 = as0 >= 0 && an ? an.data.state[as0]! : -1;
        const read = () => readAppearanceSlot(apData!, apLen, aps);
        const expr = activeExpression(world as never, e, this.layerCache.binding);
        const ro = (anim: string | undefined) => ({ ...(anim !== undefined ? { anim } : {}), ...(expr !== undefined ? { expression: expr } : {}) });
        let animName = st0 >= 0 ? atlas.animName(sid, atlas.stateAnim(sid, st0)) : undefined;
        layers = this.layerCache.get(i, e, apVer![aps]!, f, read, ro(animName));
        for (const l of layers) if (l.slot === "body") { bodyL = l; sid = l.sprite; break; }
        if (bodyL && st0 >= 0) { const nm = atlas.animName(sid, atlas.stateAnim(sid, st0)); if (nm !== animName) { animName = nm;
          layers = this.layerCache.get(i, e, apVer![aps]!, f, read, ro(nm)); bodyL = null;
          for (const l of layers) if (l.slot === "body") { bodyL = l; sid = l.sprite; break; } } }
        else if (bodyL && st0 < 0 && bodyL.animName) { layers = this.layerCache.get(i, e, apVer![aps]!, f, read, ro(bodyL.animName)); bodyL = null;
          for (const l of layers) if (l.slot === "body") { bodyL = l; sid = l.sprite; break; } }
      }
      let ok: boolean;
      const as = an ? an.slot(i) : -1;
      let st = -1, t = 0;
      if (as >= 0 && an) {
        st = an.data.state[as]!; t = (tickTime - an.data.startTick[as]!) / cx.tickHz;
        ok = atlas.resolve(sid, atlas.stateAnim(sid, st), f, t, 0, res);
      } else ok = atlas.resolve(sid, bodyL ? atlas.animIndex(sid, bodyL.animName) : -1, f, 0, sp.data.frameId[k]!, res);
      if (!ok) return;
      const scale = sp.data.scale[k]! || 1;
      const key = x + y + z * zf;
      // occlusion: tall sprites (or explicit Occluders) in front of the focus whose rect overlaps it
      let occT = 0, fade = 1;
      if (occOn && e !== this.focusEntity) {
        const os = oc.slot(i); const hgt = res.ay * scale;
        // characters / animated actors never auto-occlude (only tall static props); an explicit Occluder still opts in
        const actor = aps >= 0 || as >= 0;
        let hit = false;
        if ((os >= 0 || (hgt >= occ.minHeightPx && !actor)) && key > fk + 0.05) {
          const left = sx - res.ax * scale, top = sy - res.ay * scale;
          hit = overlapsFocus(left, left + res.w * scale, top, sy);
        }
        // actors without an explicit Occluder never fade: also reset the smoothed state (entity indices are reused, e.g.
        // a character spawned on a destroyed tree's slot inherited its fade -> semi-transparent character in chars_lineup)
        if (actor && os < 0) { if (i < this.occT.length) this.occT[i] = 0; occT = 0; } else occT = occAmount(i, hit);
        // explicit Occluder.fade overrides the style alpha (fade mode)
        if (os >= 0 && occT > 0 && occ.mode === "fade") { fade = 1 - (1 - oc.data.fade[os]!) * occT / Math.max(1e-3, 1 - occ.alpha); occT = 0; }
      }
      const ss = sh.slot(i);
      const o0 = this.writeOne(sx, sy, key, scale, res, sp.data.flags[k]! | (ls.slot(i) >= 0 ? SpriteFlag.BloomSource : 0), (i * 0.618034) % 1, fade, -OPEN, OPEN, sp.data.tint[k]! >>> 0, 0,
        ss >= 0 ? sh.data.alpha[ss]! : 0, 0, 0, ss >= 0 ? blobW * (sh.data.length[ss]! || 1) : 0);
      if (wet) { const s2 = wet.slot(i); if (s2 >= 0) { o0[20] = wet.data.level[s2]! / 255; if (o0[20] > 0.3) cx.statusFx?.("wet", x, y, z, o0[20]); } }
      if (bt) { const s2 = bt.slot(i); if (s2 >= 0) { o0[21] = bt.data.cold[s2]! / 255; o0[22] = bt.data.shivering[s2]! ? 1 : 0; o0[23] = (bt.data.heat[s2]! / 255) * cx.style.fx.flushStrength;
        if (o0[22]) cx.statusFx?.("cold", x, y, z, o0[21]); else if (bt.data.heat[s2]! > 150) cx.statusFx?.("heat", x, y, z, bt.data.heat[s2]! / 255); } }
      if (exh) { const s2 = exh.slot(i); if (s2 >= 0) o0[31] = exh.data.level[s2]! / 255; }
      if (t2s) { const s2 = t2s.slot(i); if (s2 >= 0) writeTint2(o0, t2s.data.tint[s2]! >>> 0); }
      const sw = atlas.swayOf(sid);
      if (sw) { o0[24] = sw[0]!; o0[25] = sw[1]!; o0[26] = sw[2]!; }
      o0[27] = occT;
      if (hitOf) { const hf = hitOf(e); if (hf > 0) o0[18] = -Math.min(1, hf); }
      if (bodyL) this.writeLayerTint(o0, bodyL);
      if (e === this.focusEntity && occ.silhouette) { this.silInst.set(o0.subarray(0, INSTANCE_FLOATS)); this.silInst[27] = 0; this.silOn = true; }
      this.pushOcc(o0, 0, occT, occ.mode);
      if (layers && layers.length) {
        this.characters++;
        // copy the body instance (pivot, flip, seed -> same shiver, status fx, occlusion, flash) and swap frame + tint;
        // keys step by LAYER_BIAS in resolveLayers order so a character's layers stay contiguous; outline-only copies
        // sit just behind the body so only the ring outside the union silhouette survives
        const base = this.layerBase; base.set(o0.subarray(0, INSTANCE_FLOATS));
        const lr = this.layerRes; let j = 0;
        for (const l of layers) {
          if (l === bodyL) continue; j++;
          if (lodMinor && l.minor) continue;
          if (!atlas.pageReady(l.sprite)) continue; // streamed page not resident yet: body-only fallback
          const okL = st >= 0 ? atlas.resolve(l.sprite, atlas.stateAnim(l.sprite, st), f, t, 0, lr) : atlas.resolve(l.sprite, atlas.animIndex(l.sprite, l.animName), f, 0, sp.data.frameId[k]!, lr);
          if (!okL) continue;
          o0.set(base); o0[4] = lr.entry; o0[8] = lr.ax; o0[9] = lr.ay; o0[16] = 0;
          if (outlineOn && l.outline && !(sp.data.flags[k]! & SpriteFlag.NoOutline)) {
            o0[2] = key - LAYER_BIAS * 0.5; o0[5] = (base[5]! & ~SpriteFlag.NoOutline) | OUTLINE_ONLY;
            this.pushOcc(o0, 0, occT, occ.mode); this.layerInstances++;
          }
          o0[2] = key + j * LAYER_BIAS; o0[5] = base[5]! | SpriteFlag.NoOutline;
          this.writeLayerTint(o0, l);
          this.pushOcc(o0, 0, occT, occ.mode); this.layerInstances++;
        }
        o0.set(base);
      }
      if (eq && heldOf) { const s2 = eq.slot(i); if (s2 >= 0) this.emitHeld(atlas, heldOf, eq.data.mainHandItem[s2]!, res, sx, sy, key, scale, f, (sp.data.flags[k]! & SpriteFlag.FlipX) !== 0, fade, occT, occ.mode); }
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
      const life = Math.min(1, (cx.now - v.born) / Math.max(1e-3, v.lifetime));
      const fadeOut = (v.fade ? 1 - life : Math.min(1, (v.lifetime - (cx.now - v.born)) / 0.15)) * v.alpha;
      this.push(this.writeOne(sx, sy, v.x + v.y + v.z * zf + 0.05, v.scale * (v.s0 + (v.s1 - v.s0) * life), res, (v.emissive ? SpriteFlag.Emissive : 0) | SpriteFlag.NoOutline, 0, fadeOut, -OPEN, OPEN, 0, 0, 0, 0, 0, 0), 0);
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
    // late (faded) batch: back-to-front by key
    const L = this.late, lc = L.length / INSTANCE_FLOATS; this.lateCount = lc;
    if (lc > 0) {
      const order = Array.from({ length: lc }, (_, j) => j).sort((a, b) => L[a * INSTANCE_FLOATS + 2]! - L[b * INSTANCE_FLOATS + 2]!);
      const buf = new Float32Array(L.length);
      order.forEach((j, o) => { for (let q = 0; q < INSTANCE_FLOATS; q++) buf[o * INSTANCE_FLOATS + q] = L[j * INSTANCE_FLOATS + q]!; });
      const gl = this.gl;
      if (!this.lateVbo) { this.lateVbo = gl.createBuffer()!; this.lateVao = this.makeVao(this.lateVbo); }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lateVbo); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
    }
  }

  private gatherPieces(cx: PrepareContext, bp: ReturnType<World["store"]>, hasFocus: boolean, fwx: number, fwy: number, fwz: number): void {
    const { world, atlas, rect } = cx; const tr = world.store(Transform);
    const d = bp.data as Record<string, ArrayLike<number>>;
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, zs = this.iso.zStep, zf = this.zFactor;
    const res = this.res;
    // cutaway region from BuildingGrid: tiles of the building the focus entity stands in
    const playerLevel = hasFocus ? terrainZToFloor(fwz, Math.max(0, cx.groundZAt?.(Math.floor(fwx), Math.floor(fwy)) ?? 0)) : 0;
    const cut = hasFocus && cx.grid ? cutawayRegion(cx.grid, Math.floor(fwx), Math.floor(fwy), playerLevel, 600, (sid) => atlas.isRoof(sid)) : null;
    this.cutawayActive = !!cut;
    const scratch = this.staticScratch; for (const v of scratch.values()) v.length = 0;
    const checksums = new Map<string, number>();
    const tmp: number[] = []; const nightSet = cx.bindings.nightEmissive?.sprites; this.nightGate = cx.bindings.nightEmissive?.gate ?? 1;
    for (let k = 0; k < bp.size; k++) {
      const e = bp.dense[k]!; const i = entityIndex(e); const ts = tr.slot(i); if (ts < 0) continue;
      const vis = d.visualId![k]!; const rot = d.rotation![k]! & 3; const level = d.level![k]!; const layer = d.layer![k]!;
      const ghost = d.ghost![k]!; const dmg = d.damageStage![k]!; const tints = cx.bindings.pieceTints?.(e); const tint = tints ? tints[0] : d.tint![k]! >>> 0;
      if (!atlas.resolvePiece(vis, d.variant![k]!, rot, dmg, res, cx.bindings.pieceState?.(e) ?? (d.state ? d.state[k]! - 1 : -1))) continue;
      const info = atlas.pieceInfo(vis); const sway = atlas.swayOf(vis);
      const fw = info ? (rot & 1 ? info.fh : info.fw) : 1, fh = info ? (rot & 1 ? info.fw : info.fh) : 1;
      const ax = Math.floor(tr.data.x[ts]!), ay = Math.floor(tr.data.y[ts]!);
      const roof = atlas.isRoof(vis);
      // roofs are deck-layer (0) pieces placed on the level above the walls and drawn from that level's floor (= wall top)
      const z = floorToTerrainZ(level, tr.data.z[ts]!);
      const cutaway = !!cut && (level > playerLevel || (roof && level === playerLevel)) && footprintHits(cut, ax, ay, fw, fh);
      // occlusion (walls etc. not in cutaway): a hit, or a still-fading piece, is drawn dynamically this frame
      let occT = 0;
      if (!cutaway && !flatLayer(layer, roof) && this.occ.occOn) {
        const bottom = (ax + ay + fw + fh) * hh - z * zs; // front footprint corner
        const pivotY = cx.pieceAnchor === "front" ? bottom : (ax + ay + (fw + fh) / 2) * hh - z * zs;
        const top = pivotY - res.ay; const left = (ax - (ay + fh)) * hw, right = (ax + fw - ay) * hw;
        const front = ax + fw + ay + fh - 2 + 1.95 + z * zf;
        const hit = res.ay >= cx.style.occlusion.minHeightPx && front > this.occ.fk + 0.05 && this.occ.overlapsFocus(left, right, top, bottom);
        occT = this.occ.occAmount(i, hit);
      }
      const dynamic = ghost > 0 || cutaway || occT > 0;
      const alpha = cutaway ? cx.style.cutawayAlpha : 1;
      // footprint far corner (fx, fy); sprite pivot = footprint centre on the ground (art guide / sample manifest)
      // or the front-most footprint corner (cx.pieceAnchor === "front")
      const fx = ax + fw, fy = ay + fh;
      const pvx = cx.pieceAnchor === "front" ? fx : ax + fw / 2, pvy = cx.pieceAnchor === "front" ? fy : ay + fh / 2;
      const sx = (pvx - pvy) * hw, sy = (pvx + pvy) * hh - z * zs;
      const flat = flatLayer(layer, roof); // deck pieces (floors/foundations), never roofs
      const flags = (flat ? SpriteFlag.Flat : 0) | (res.flipX ? SpriteFlag.FlipX : 0) | (nightSet?.has(vis) ? 64 : 0);
      const dmgOverlay = dmg > 0 && !res.hasDamageFrames ? dmg : 0;
      const bias = roof ? 0.05 : layer * 0.01; // roofs above every other layer of the cell
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
        o[27] = occT;
        if (sway) { o[24] = sway[0]!; o[25] = sway[1]!; o[26] = sway[2]!; } // SpriteDef.sway (+ masks.sway weights in the shader)
        if (tints?.[1]) writeTint2(o, tints[1]);
        for (let q = 0; q < INSTANCE_FLOATS; q++) tmp.push(o[q]!);
        if (single) break;
      }
      if (dynamic) {
        if (sx < rect.x0 - 512 || sx > rect.x1 + 512 || sy < rect.y0 - 256 || sy > rect.y1 + 1024) continue;
        for (let j = 0; j < tmp.length; j += INSTANCE_FLOATS) this.pushOcc(tmp, j, occT, cx.style.occlusion.mode);
      } else {
        const ck = chunkKey(Math.floor(ax / CHUNK_SIZE), Math.floor(ay / CHUNK_SIZE));
        let list = scratch.get(ck); if (!list) scratch.set(ck, (list = []));
        for (const v of tmp) list.push(v);
        let h = checksums.get(ck) ?? 0x811c9dc5;
        for (let j = 0; j < tmp.length; j++) h = Math.imul(h ^ Math.round(tmp[j]! * 64), 16777619) >>> 0;
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
    const oc = style.occlusion;
    gl.uniform1i(u.uOccMode!, oc.mode === "dither" ? 1 : 0); gl.uniform1f(u.uOccAlpha!, oc.alpha); gl.uniform1f(u.uOccRadius!, oc.radiusPx);
    gl.uniform2f(u.uFocusScr!, this.focusScr[0], this.focusScr[1]); gl.uniform1i(u.uSilhouette!, 0); gl.uniform4fv(u.uSilColor!, oc.silhouetteColor);
    gl.uniform1f(u.uAlphaMul!, 1); gl.uniform1f(u.uTexel!, 1 / atlas.layerSize); gl.uniform1f(u.uEmisStrength!, style.emissiveStrength); gl.uniform1f(u.uNightGate!, this.nightGate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.tex); gl.uniform1i(u.uAtlas!, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas.frameTex); gl.uniform1i(u.uFrames!, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.emisTex); gl.uniform1i(u.uEmis!, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.sheenTex); gl.uniform1i(u.uSheenM!, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.swayTex); gl.uniform1i(u.uSwayM!, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.tintMaskTex); gl.uniform1i(u.uTintM!, 5);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, atlas.tintTex); gl.uniform1i(u.uTints!, 6);
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

  /** Faded occluders (late batch): depth-tested, no depth write. Call after drawSilhouette. */
  drawLate(view: Float32Array, depth: Float32Array, atlas: AtlasManager, time: number, wind: number, style: StyleConfig, stats: FrameStats): void {
    if (this.lateCount === 0 || !atlas.tex || !this.lateVao) return;
    const gl = this.gl; const { u } = this.prog;
    this.setup("sprite", u, view, depth, atlas, time, wind, [0, 0], 0, style);
    gl.depthMask(false);
    gl.bindVertexArray(this.lateVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lateCount); gl.bindVertexArray(null);
    gl.depthMask(true);
    stats.drawCalls++; stats.sprites += this.lateCount;
  }

  /** Focus (local player) silhouette through occluders: one instance, depth GREATER, no depth write. Call after draw("sprite"). */
  drawSilhouette(view: Float32Array, depth: Float32Array, atlas: AtlasManager, time: number, wind: number, style: StyleConfig, stats: FrameStats): void {
    if (!this.silOn || !style.occlusion.enabled || !style.occlusion.silhouette || !atlas.tex) return;
    const gl = this.gl; const { u } = this.prog;
    if (!this.silVbo) { this.silVbo = gl.createBuffer()!; this.silVao = this.makeVao(this.silVbo); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.silVbo); gl.bufferData(gl.ARRAY_BUFFER, this.silInst, gl.DYNAMIC_DRAW);
    this.setup("sprite", u, view, depth, atlas, time, wind, [0, 0], 0, style);
    gl.uniform1i(u.uSilhouette!, 1); gl.uniform1f(u.uOutline!, 0);
    gl.depthFunc(gl.GREATER); gl.depthMask(false);
    gl.bindVertexArray(this.silVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1); gl.bindVertexArray(null);
    gl.depthMask(true); gl.depthFunc(gl.LESS); gl.uniform1i(u.uSilhouette!, 0);
    stats.drawCalls++;
  }
}

/**
 * Deck layer (floors, foundations; gameplay building/structure.ts LAYER_DECK, world BuildingGrid layer 0). Roofs share
 * that layer but are not flat, so they are told apart by sprite (AtlasManager.isRoof), never by a layer number.
 * TODO(world): import a named layer enum once @engine/world exports one.
 */
export let PIECE_LAYER_DECK = 0;
/** Override the deck layer index (inject gameplay's LAYER_DECK). */
export function setPieceLayers(l: { deck: number }): void { PIECE_LAYER_DECK = l.deck; }
const flatLayer = (layer: number, roof: boolean): boolean => layer === PIECE_LAYER_DECK && !roof;

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
export function cutawayRegion(grid: BuildingGrid, tx: number, ty: number, level: number, maxTiles = 600, isRoofSprite: (spriteId: number) => boolean = () => false): Set<string> | null {
  // anything on a higher level (roofs included: deck pieces of level+1) covers the tile; isRoofSprite is kept for
  // roof pieces gameplay places on the walls' own level
  const roofAt = (x: number, y: number): boolean => {
    const id = grid.at(x, y, level, PIECE_LAYER_DECK); if (!id) return false;
    const inst = grid.get(id); if (!inst) return false; const sp = grid.pieces.get(inst.piece).sprite;
    return (sp !== undefined && isRoofSprite(sp)) || grid.pieces.get(inst.piece).key.startsWith("roof");
  };
  const covered = (x: number, y: number): boolean => {
    for (let lv = level + 1; lv < 16; lv++) if (grid.at(x, y, lv) !== 0) return true;
    return roofAt(x, y);
  };
  if (!covered(tx, ty)) return null;
  const inside = (x: number, y: number): boolean => covered(x, y) || grid.at(x, y, level, PIECE_LAYER_DECK) !== 0;
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
