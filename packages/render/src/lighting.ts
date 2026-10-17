/**
 * Light accumulation pass: renders into a half-resolution lightmap that is cleared to the
 * ambient (time-of-day) colour, then every visible LightSource is splatted additively as an
 * iso-squashed (2:1) radial falloff quad with shader-side flicker. One instanced draw call.
 * Values are stored at 0.5 scale in RGBA8 so lights can over-brighten up to 2x in composite.
 */
import { entityIndex, PrevTransform, Transform, type World } from "@engine/core";
import type { IsoConfig } from "@engine/world";
import { createProgram, createTexture, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import { LightSource } from "./components.js";
import type { Rect } from "./camera.js";

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
  /** Lightmap resolution divisor (2 = half res). */
  readonly downscale = 2;

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
    this.tex = createTexture(gl, lw, lh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  prepare(world: World, alpha: number, rect: Rect, enabled: boolean): void {
    this.count = 0; if (!enabled) return;
    const ls = world.store(LightSource), tr = world.store(Transform), pv = world.store(PrevTransform);
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, zs = this.iso.zStep;
    if (this.data.length < ls.size * FLOATS) this.data = new Float32Array(ls.size * FLOATS * 2);
    const d = this.data; let n = 0;
    for (let k = 0; k < ls.size; k++) {
      const i = entityIndex(ls.dense[k]!); const ts = tr.slot(i); if (ts < 0) continue;
      const ps = pv.slot(i);
      let x = tr.data.x[ts]!, y = tr.data.y[ts]!, z = tr.data.z[ts]!;
      if (ps >= 0) { x = pv.data.x[ps]! + (x - pv.data.x[ps]!) * alpha; y = pv.data.y[ps]! + (y - pv.data.y[ps]!) * alpha; z = pv.data.z[ps]! + (z - pv.data.z[ps]!) * alpha; }
      const sx = (x - y) * hw, sy = (x + y) * hh - z * zs;
      const r = ls.data.radius[k]! * hw * 1.414;
      if (sx + r < rect.x0 || sx - r > rect.x1 || sy + r < rect.y0 || sy - r > rect.y1) continue;
      const o = n * FLOATS;
      d[o] = sx; d[o + 1] = sy; d[o + 2] = r; d[o + 3] = ls.data.intensity[k]!;
      d[o + 4] = ls.data.r[k]!; d[o + 5] = ls.data.g[k]!; d[o + 6] = ls.data.b[k]!; d[o + 7] = ls.data.flicker[k]!;
      n++;
    }
    this.count = n;
  }

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
