/**
 * Batched sprite renderer: gathers Sprite+Transform entities straight from the ECS SoA stores,
 * interpolates PrevTransform->Transform by alpha, frustum-culls, sorts back-to-front by iso depth
 * key (radix-friendly packed u32 sort), and draws everything with ONE instanced draw call
 * (plus one more for sun shadows). Depth is also written per vertex (billboards are treated as
 * vertical planes) so sprites interleave correctly with terrain cliffs.
 */
import { entityIndex, PrevTransform, Transform, type World } from "@engine/core";
import type { IsoConfig } from "@engine/world";
import { createProgram, GLSL_COMMON, type FrameStats, type Program } from "./gl/util.js";
import { Sprite, Shadow, Occluder, SpriteFlag } from "./components.js";
import type { GpuAtlas } from "./atlas.js";
import type { Rect } from "./camera.js";

const FLOATS = 12; // per instance: (sx, sy, key, scale) (frame, flags, seed, fade) (shadowAlpha, shadowLen, 0, 0)

const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec4 aA; // sx, sy, key, scale
layout(location=1) in vec4 aB; // frame, flags, seed, fade
layout(location=2) in vec4 aC; // shadowAlpha, shadowLen
${GLSL_COMMON}
uniform highp sampler2D uFrames;
uniform float uZPerPx;    // depth key per px of sprite height (= zFactor / zStep)
uniform float uTime, uWind;
uniform int uShadowPass;
uniform vec2 uShadowDir;
out vec2 vUv; out float vFade; flat out int vFlags;
void main() {
  int frame = int(aB.x + 0.5); int flags = int(aB.y + 0.5);
  vec4 uvr = texelFetch(uFrames, ivec2(frame * 2, 0), 0);
  vec4 dim = texelFetch(uFrames, ivec2(frame * 2 + 1, 0), 0); // w, h, ax, ay
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  float s = aA.w;
  float flip = (flags & 1) != 0 ? -1.0 : 1.0;
  float px = (c.x * dim.x - dim.z) * s * flip;
  float hp = (dim.w - c.y * dim.y) * s;      // height above foot (px), >0 upward
  if ((flags & 4) != 0) px += sin(uTime * 1.6 + aB.z * 6.283) * uWind * max(hp, 0.0) * 0.05;
  vUv = vec2(mix(uvr.x, uvr.z, c.x), mix(uvr.y, uvr.w, c.y));
  vFlags = flags; vFade = aB.w;
  vec2 iso; float key;
  if (uShadowPass == 1) {
    if (aC.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    iso = aA.xy + vec2(px, 0.0) + uShadowDir * aC.y * hp;
    key = aA.z + 0.005;
    vFade = aC.x;
  } else {
    iso = aA.xy + vec2(px, -hp);
    key = aA.z + 0.02 + max(hp, 0.0) * uZPerPx;
  }
  gl_Position = vec4(isoToClip(iso), keyToNdc(key), 1.0);
}`;

const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; in float vFade; flat in int vFlags;
uniform sampler2D uAtlas;
uniform int uShadowPass;
uniform float uShadowAlpha;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oEmissive;
void main() {
  vec4 t = texture(uAtlas, vUv);
  if (uShadowPass == 1) {
    if (t.a < 0.3) discard;
    oColor = vec4(0.0, 0.0, 0.0, uShadowAlpha * vFade);
    oEmissive = vec4(0.0);
    return;
  }
  if (t.a < 0.35) discard;
  float a = smoothstep(0.35, 0.75, t.a) * vFade;
  oColor = vec4(t.rgb, a);
  oEmissive = vec4((vFlags & 2) != 0 ? 1.0 : 0.0, 0.0, 0.0, a);
}`;

export class SpriteBatch {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private capacity = 0;
  private inst = new Float32Array(0);
  private tmp = new Float32Array(0);
  private sortKeys = new Uint32Array(0);
  private gpuBytes = 0;
  visible = 0;
  /** Entity whose iso position makes covering Occluders fade (local player). -1 = none. */
  focusEntity = -1;

  constructor(private gl: WebGL2RenderingContext, private iso: IsoConfig, private zFactor: number) {
    this.prog = createProgram(gl, VS, FS, "sprites");
    this.vao = gl.createVertexArray()!; this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, FLOATS * 4, a * 16); gl.vertexAttribDivisor(a, 1);
    }
    gl.bindVertexArray(null);
    this.ensure(4096);
  }

  private ensure(n: number): void {
    if (n <= this.capacity) return;
    let c = Math.max(this.capacity, 1024); while (c < n) c *= 2;
    this.capacity = Math.min(c, 65536);
    this.inst = new Float32Array(this.capacity * FLOATS); this.tmp = new Float32Array(this.capacity * FLOATS);
    this.sortKeys = new Uint32Array(this.capacity);
  }

  /** CPU phase: gather + interpolate + cull + sort into the instance buffer. */
  prepare(world: World, alpha: number, rect: Rect, atlas: GpuAtlas, depthMin: number, depthRange: number): void {
    const sp = world.store(Sprite), tr = world.store(Transform), pv = world.store(PrevTransform);
    const sh = world.store(Shadow), oc = world.store(Occluder);
    this.ensure(sp.size);
    const hw = this.iso.tileW / 2, hh = this.iso.tileH / 2, zs = this.iso.zStep, zf = this.zFactor;
    const frames = atlas.atlas.frames; const margin = atlas.atlas.maxExtent * 2;
    const r0x = rect.x0 - margin, r1x = rect.x1 + margin, r0y = rect.y0 - margin * 0.25, r1y = rect.y1 + margin;
    const tx = tr.data.x, ty = tr.data.y, tz = tr.data.z, px = pv.data.x, py = pv.data.y, pz = pv.data.z;
    const sAtlas = sp.data.atlasId, sFrame = sp.data.frameId, sFlags = sp.data.flags, sScale = sp.data.scale;
    const tmp = this.tmp, keys = this.sortKeys; const cap = this.capacity;
    // focus (player) iso point for occluder fading
    let fx = 1e9, fy = 1e9, fk = -1e9;
    if (this.focusEntity >= 0 && world.isAlive(this.focusEntity)) {
      const fi = entityIndex(this.focusEntity); const ts = tr.slot(fi);
      if (ts >= 0) {
        const ps = pv.slot(fi);
        const x = ps >= 0 ? px[ps]! + (tx[ts]! - px[ps]!) * alpha : tx[ts]!;
        const y = ps >= 0 ? py[ps]! + (ty[ts]! - py[ps]!) * alpha : ty[ts]!;
        const z = ps >= 0 ? pz[ps]! + (tz[ts]! - pz[ps]!) * alpha : tz[ts]!;
        fx = (x - y) * hw; fy = (x + y) * hh - z * zs - 20; fk = x + y + z * zf;
      }
    }
    let n = 0;
    for (let k = 0; k < sp.size && n < cap; k++) {
      if (sAtlas[k] !== 0) continue; // only atlas 0 for now
      const e = sp.dense[k]!; const i = entityIndex(e);
      const ts = tr.slot(i); if (ts < 0) continue;
      const ps = pv.slot(i);
      let x = tx[ts]!, y = ty[ts]!, z = tz[ts]!;
      if (ps >= 0) { x = px[ps]! + (x - px[ps]!) * alpha; y = py[ps]! + (y - py[ps]!) * alpha; z = pz[ps]! + (z - pz[ps]!) * alpha; }
      const sx = (x - y) * hw, sy = (x + y) * hh - z * zs;
      if (sx < r0x || sx > r1x || sy < r0y || sy > r1y) continue;
      const frame = sFrame[k]!; const f = frames[frame]; if (!f) continue;
      const scale = sScale[k]! || 1;
      const key = x + y + z * zf;
      let fade = 1;
      const os = oc.slot(i);
      if (os >= 0 && key > fk + 0.3) {
        const left = sx - f.ax * scale, top = sy - f.ay * scale;
        if (fx > left && fx < left + f.w * scale && fy > top && fy < sy) fade = oc.data.fade[os]!;
      }
      const ss = sh.slot(i);
      const o = n * FLOATS;
      tmp[o] = sx; tmp[o + 1] = sy; tmp[o + 2] = key; tmp[o + 3] = scale;
      tmp[o + 4] = frame; tmp[o + 5] = sFlags[k]!; tmp[o + 6] = (i * 0.618034) % 1; tmp[o + 7] = fade;
      tmp[o + 8] = ss >= 0 ? sh.data.alpha[ss]! : 0; tmp[o + 9] = ss >= 0 ? (sh.data.length[ss]! || 1) : 0; tmp[o + 10] = 0; tmp[o + 11] = 0;
      // 16-bit quantized depth (back-to-front) | 16-bit local index
      const q = Math.max(0, Math.min(65535, ((key - depthMin) / depthRange) * 65535)) | 0;
      keys[n] = ((q << 16) | n) >>> 0;
      n++;
    }
    const sorted = keys.subarray(0, n); sorted.sort();
    const inst = this.inst;
    for (let j = 0; j < n; j++) {
      const src = (sorted[j]! & 0xffff) * FLOATS, dst = j * FLOATS;
      for (let q = 0; q < FLOATS; q++) inst[dst + q] = tmp[src + q]!;
    }
    this.visible = n;
  }

  /** Uploads the prepared instance data (once per frame, before draw). */
  upload(): void {
    if (this.visible === 0) return;
    const gl = this.gl; const bytes = this.visible * FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (bytes > this.gpuBytes) { this.gpuBytes = this.capacity * FLOATS * 4; gl.bufferData(gl.ARRAY_BUFFER, this.gpuBytes, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, this.visible * FLOATS);
  }

  /** Draws shadows (pass 1) then sprites (pass 2). Caller sets blend/depth state per pass. */
  draw(pass: "shadow" | "sprite", view: Float32Array, depth: Float32Array, atlas: GpuAtlas, time: number, wind: number,
    shadowDir: readonly [number, number], shadowAlpha: number, stats: FrameStats): void {
    if (this.visible === 0) return;
    const gl = this.gl; const { u } = this.prog;
    if (pass === "shadow" && shadowAlpha <= 0) return;
    gl.useProgram(this.prog.prog);
    gl.uniform4fv(u.uView!, view); gl.uniform2fv(u.uDepth!, depth);
    gl.uniform1f(u.uZPerPx!, this.zFactor / this.iso.zStep);
    gl.uniform1f(u.uTime!, time); gl.uniform1f(u.uWind!, wind);
    gl.uniform1i(u.uShadowPass!, pass === "shadow" ? 1 : 0);
    gl.uniform2f(u.uShadowDir!, shadowDir[0], shadowDir[1]); gl.uniform1f(u.uShadowAlpha!, shadowAlpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas.tex); gl.uniform1i(u.uAtlas!, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas.frameTex); gl.uniform1i(u.uFrames!, 1);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visible);
    gl.bindVertexArray(null);
    stats.drawCalls++;
    if (pass === "sprite") stats.sprites = this.visible;
  }
}

export { SpriteFlag };
