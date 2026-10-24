/**
 * Light accumulation pass: renders into a half-resolution lightmap that is cleared to the
 * ambient (time-of-day) colour, then every visible LightSource is splatted additively as an
 * iso-squashed (2:1) radial falloff quad with shader-side flicker. One instanced draw call.
 * Values are stored at 0.5 scale in RGBA8 so lights can over-brighten up to 2x in composite.
 */
import { entityIndex, PrevTransform, Transform, type World } from "@engine/core";
import type { IsoConfig } from "@engine/world";
import { createColorTarget, createProgram, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import { LightSource } from "./components.js";
import type { ComponentDef, Entity } from "@engine/core";

export const MAX_HEAT = 16;
/** How an Emitter kind id (gameplay-defined) is visualised. */
export interface EmitterVisual { type: "light" | "heat"; color: readonly [number, number, number]; intensity: number; flicker: number }
/** Default mapping for gameplay's EmitterKind (Heat = 1, Light = 2). Unknown kinds are ignored. */
export const DEFAULT_EMITTER_KINDS: Record<number, EmitterVisual> = {
  1: { type: "heat", color: [1, 0.6, 0.3], intensity: 1, flicker: 0 },
  2: { type: "light", color: [1, 0.62, 0.32], intensity: 1.3, flicker: 0.45 },
};
export interface EmitterContext { emitter?: ComponentDef | undefined; lit?: ComponentDef | undefined; kinds: Record<number, EmitterVisual> }
import type { Rect } from "./camera.js";
import type { TransformSource } from "./transformSource.js";

const FLOATS = 8;
const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec4 aA; // sx, sy, radiusPx, intensity
layout(location=1) in vec4 aB; // r, g, b, flicker
${GLSL_COMMON}
uniform float uTime, uStrength;
out vec2 vLocal; out vec3 vColor;
float n1(float x) { return fract(sin(x) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); return mix(n1(i), n1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vLocal = c;
  float seed = aA.x * 0.013 + aA.y * 0.007;
  float fl = aB.w * (noise(uTime * 9.0 + seed * 31.0) * 0.7 + noise(uTime * 23.0 + seed * 17.0) * 0.3 - 0.5) * 2.0;
  float r = aA.z * (1.0 + 0.08 * fl);
  vColor = aB.rgb * aA.w * uStrength * (1.0 + 0.35 * fl);
  vec2 iso = aA.xy + c * vec2(r, r * 0.5);
  gl_Position = vec4(isoToClip(iso), 0.0, 1.0);
}`;
const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 vLocal; in vec3 vColor;
out vec4 o;
void main() {
  float d = dot(vLocal, vLocal);
  if (d >= 1.0) discard;
  float att = (1.0 - d); att *= att;
  float core = exp(-d * 9.0) * 0.6;
  o = vec4(vColor * (att + core) * 0.5, 1.0);
}`;

export class LightPass {
  private prog: Program;
  private vao: WebGLVertexArrayObject; private vbo: WebGLBuffer;
  private data = new Float32Array(256 * FLOATS);
  fbo: WebGLFramebuffer | null = null; tex: WebGLTexture | null = null;
  private w = 0; private h = 0;
  count = 0;
  private xf = new Float32Array(4);
  /** Lightmap resolution divisor (2 = half res). */
  /** lightmap downscale (2 = half-res, 4 = quarter-res on low quality tiers) */
  downscale = 2;

  constructor(private gl: WebGL2RenderingContext, private iso: IsoConfig) {
    this.prog = createProgram(gl, VS, FS, "lights");
    this.vao = gl.createVertexArray()!; this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    for (let a = 0; a < 2; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, FLOATS * 4, a * 16); gl.vertexAttribDivisor(a, 1); }
    gl.bindVertexArray(null);
  }

  resize(w: number, h: number): void {
    const gl = this.gl; const lw = Math.max(1, Math.ceil(w / this.downscale)), lh = Math.max(1, Math.ceil(h / this.downscale));
    if (lw === this.w && lh === this.h) return;
    this.w = lw; this.h = lh;
    if (this.tex) gl.deleteTexture(this.tex); if (this.fbo) gl.deleteFramebuffer(this.fbo);
    // LDR lightmap: RGBA8 stores light * 0.5 (composite decodes x2), renderable + filterable everywhere
    const t = createColorTarget(gl, lw, lh, gl.LINEAR, "lightmap"); this.tex = t.tex; this.fbo = t.fbo;
  }

  /** Heat emitters visible this frame (screen sx, sy, radius px, strength), for the shimmer pass. */
  heat = new Float32Array(MAX_HEAT * 4);
  heatCount = 0;

  prepare(world: World, alpha: number, rect: Rect, enabled: boolean, source?: TransformSource, fx?: EmitterContext): void {
    this.count = 0; this.heatCount = 0;
    const tr = world.store(Transform), pv = world.store(PrevTransform);
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, zs = this.iso.zStep;
    const pos = (e: Entity): boolean => {
      const i = entityIndex(e); const ts = tr.slot(i); if (ts < 0) return false;
      let x = tr.data.x[ts]!, y = tr.data.y[ts]!, z = tr.data.z[ts]!; const ps = pv.slot(i);
      if (source && source.entities.has(e) && source.sample(world, e, alpha, this.xf)) { x = this.xf[0]!; y = this.xf[1]!; z = this.xf[2]!; }
      else if (ps >= 0) { x = pv.data.x[ps]! + (x - pv.data.x[ps]!) * alpha; y = pv.data.y[ps]! + (y - pv.data.y[ps]!) * alpha; z = pv.data.z[ps]! + (z - pv.data.z[ps]!) * alpha; }
      this.sx = (x - y) * hw; this.sy = (x + y) * hh - z * zs; return true;
    };
    const visible = (r: number): boolean => !(this.sx + r < rect.x0 || this.sx - r > rect.x1 || this.sy + r < rect.y0 || this.sy - r > rect.y1);
    const add = (radiusTiles: number, intensity: number, r: number, g: number, b: number, flicker: number): void => {
      const rp = radiusTiles * hw * 1.414; if (!visible(rp)) return;
      if (this.data.length < (this.count + 1) * FLOATS) { const nd = new Float32Array(this.data.length * 2); nd.set(this.data); this.data = nd; }
      const o = this.count * FLOATS, d = this.data;
      d[o] = this.sx; d[o + 1] = this.sy; d[o + 2] = rp; d[o + 3] = intensity; d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = flicker;
      this.count++;
    };
    if (enabled) {
      const ls = world.store(LightSource);
      for (let k = 0; k < ls.size; k++) if (pos(ls.dense[k]!)) add(ls.data.radius[k]!, ls.data.intensity[k]!, ls.data.r[k]!, ls.data.g[k]!, ls.data.b[k]!, ls.data.flicker[k]!);
    }
    // core Emitter {kind, radius, strength, falloff}: kinds mapped via the emitter table; Fuel/Burning.lit gates fires
    const em = fx?.emitter ? world.store(fx.emitter) : undefined;
    if (em && fx) {
      const lit = fx.lit ? world.store(fx.lit) : undefined;
      const ed = em.data as Record<string, ArrayLike<number>>;
      for (let k = 0; k < em.size; k++) {
        const e = em.dense[k]! as Entity; const i = entityIndex(e);
        if (lit) { const s = lit.slot(i); if (s >= 0 && !(lit.data as Record<string, ArrayLike<number>>).lit![s]) continue; }
        const kind = fx.kinds[ed.kind![k]!]; if (!kind) continue;
        if (!pos(e)) continue;
        const radius = ed.radius![k]!, strength = ed.strength![k]!;
        if (kind.type === "light" && enabled) add(radius, strength * kind.intensity, kind.color[0], kind.color[1], kind.color[2], kind.flicker);
        else if (kind.type === "heat" && this.heatCount < MAX_HEAT) {
          const rp = radius * hw * 1.414; if (!visible(rp)) continue;
          const o = this.heatCount * 4; this.heat[o] = this.sx; this.heat[o + 1] = this.sy; this.heat[o + 2] = rp; this.heat[o + 3] = Math.min(1, strength); this.heatCount++;
        }
      }
    }
  }
  private sx = 0; private sy = 0;

  draw(view: Float32Array, ambient: readonly [number, number, number], strength: number, time: number, stats: FrameStats): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(ambient[0] * 0.5, ambient[1] * 0.5, ambient[2] * 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    stats.lights = this.count;
    if (this.count === 0) return;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const { u } = this.prog;
    gl.useProgram(this.prog.prog);
    gl.uniform4fv(u.uView!, view); gl.uniform1f(u.uTime!, time); gl.uniform1f(u.uStrength!, strength);
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * FLOATS), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    stats.drawCalls++;
  }
}
