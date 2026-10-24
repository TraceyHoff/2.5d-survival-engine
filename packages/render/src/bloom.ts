/**
 * Bloom restricted to emissive pixels: source = scene colour x emissive mask (emissive pages / Emissive-flagged
 * sprites such as fire, lit windows, glowing eyes), never a global brightness threshold. Half-res extract,
 * separable 9-tap blur (H then V). 3 draw calls.
 */
import { createColorTarget, createProgram, FULLSCREEN_VS, type FrameStats, type Program } from "./gl/util.js";

const EXTRACT = /* glsl */ `#version 300 es
precision highp float; in vec2 vUv; uniform highp sampler2D uScene, uEmissive; out vec4 o;
void main() { float e = clamp(texture(uEmissive, vUv).g, 0.0, 1.0); o = vec4(texture(uScene, vUv).rgb * e, 1.0); }`;
const BLUR = /* glsl */ `#version 300 es
precision highp float; in vec2 vUv; uniform highp sampler2D uSrc; uniform vec2 uStep; out vec4 o;
void main() {
  const float w[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 c = texture(uSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) { c += texture(uSrc, vUv + uStep * float(i)).rgb * w[i]; c += texture(uSrc, vUv - uStep * float(i)).rgb * w[i]; }
  o = vec4(c, 1.0);
}`;

export class BloomPass {
  private extract: Program; private blur: Program; private vao: WebGLVertexArrayObject;
  private tex: (WebGLTexture | null)[] = [null, null]; private fbo: (WebGLFramebuffer | null)[] = [null, null];
  private w = 0; private h = 0;
  constructor(private gl: WebGL2RenderingContext) {
    this.extract = createProgram(gl, FULLSCREEN_VS, EXTRACT, "bloom-extract");
    this.blur = createProgram(gl, FULLSCREEN_VS, BLUR, "bloom-blur");
    this.vao = gl.createVertexArray()!;
  }
  /** Framebuffers (diagnostics). */
  get fbos(): readonly (WebGLFramebuffer | null)[] { return this.fbo; }
  /** Result texture (valid after draw). */
  get output(): WebGLTexture | null { return this.tex[0] ?? null; }
  resize(w: number, h: number): void {
    const gl = this.gl; const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    if (bw === this.w && bh === this.h) return; this.w = bw; this.h = bh;
    for (let i = 0; i < 2; i++) {
      if (this.tex[i]) gl.deleteTexture(this.tex[i]!); if (this.fbo[i]) gl.deleteFramebuffer(this.fbo[i]!);
      const t = createColorTarget(gl, bw, bh, gl.LINEAR, `bloom${i}`); this.tex[i] = t.tex; this.fbo[i] = t.fbo;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  draw(scene: WebGLTexture, emissive: WebGLTexture, radiusPx: number, stats: FrameStats): void {
    const gl = this.gl; gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, this.w, this.h); gl.bindVertexArray(this.vao);
    const tex = (unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null | undefined): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc ?? null, unit); };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0]!); gl.useProgram(this.extract.prog);
    tex(0, scene, this.extract.u.uScene); tex(1, emissive, this.extract.u.uEmissive);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const step = Math.max(0.5, radiusPx / 8);
    gl.useProgram(this.blur.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1]!); tex(0, this.tex[0]!, this.blur.u.uSrc); gl.uniform2f(this.blur.u.uStep ?? null, step / this.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0]!); tex(0, this.tex[1]!, this.blur.u.uSrc); gl.uniform2f(this.blur.u.uStep ?? null, 0, step / this.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    stats.drawCalls += 3;
  }
}
