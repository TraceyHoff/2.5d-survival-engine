/**
 * Composite pass (fullscreen): scene colour x lightmap (emissive pixels keep full brightness),
 * then fog/haze (world-anchored scrolling fbm), storm darkening, night grading and vignette.
 */
import { createProgram, FULLSCREEN_VS, type Program } from "./gl/util.js";

const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 vUv;
uniform sampler2D uScene, uEmissive, uLight;
uniform vec3 uAmbient, uFogColor;
uniform float uFog, uHaze, uStorm, uTime, uNight, uWind;
uniform vec2 uWorldOrigin; // iso px of the bottom-left screen corner
uniform vec2 uWorldSize;   // iso px covered by the screen
out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  float emis = texture(uEmissive, vUv).r;
  vec3 light = texture(uLight, vUv).rgb * 2.0;
  vec3 col = mix(scene * light, scene * max(light, vec3(1.0)), emis);
  // storm/rain darkening + slight desaturation
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), 0.35 * uStorm + 0.25 * uNight) * (1.0 - 0.35 * uStorm);
  // world-anchored fog: noise sampled in iso space so it sticks to the ground while drifting with wind
  vec2 wp = (uWorldOrigin + vUv * uWorldSize) / 380.0;
  float n = fbm(wp + vec2(uTime * (0.04 + 0.12 * uWind), uTime * 0.015));
  float fogAmt = clamp(uFog * (0.45 + 0.75 * n), 0.0, 0.92);
  vec3 fogCol = uFogColor * (0.25 + 0.75 * clamp(dot(uAmbient, vec3(0.33)), 0.0, 1.0)) + light * 0.08;
  col = mix(col, fogCol, fogAmt);
  col += vec3(1.0, 0.6, 0.35) * uHaze * 0.06;
  // vignette, stronger at night
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * (0.35 + 0.6 * uNight);
  o = vec4(col, 1.0);
}`;

export class CompositePass {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, FULLSCREEN_VS, FS, "composite");
    this.vao = gl.createVertexArray()!;
  }
  draw(scene: WebGLTexture, emissive: WebGLTexture, light: WebGLTexture, p: {
    ambient: readonly [number, number, number]; fogColor: readonly [number, number, number]; fog: number; haze: number;
    storm: number; night: number; wind: number; time: number; origin: readonly [number, number]; size: readonly [number, number];
  }): void {
    const gl = this.gl; const { u } = this.prog;
    gl.useProgram(this.prog.prog);
    const bind = (unit: number, t: WebGLTexture, name: string): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name]!, unit); };
    bind(0, scene, "uScene"); bind(1, emissive, "uEmissive"); bind(2, light, "uLight");
    gl.uniform3f(u.uAmbient!, p.ambient[0], p.ambient[1], p.ambient[2]); gl.uniform3f(u.uFogColor!, p.fogColor[0], p.fogColor[1], p.fogColor[2]);
    gl.uniform1f(u.uFog!, p.fog); gl.uniform1f(u.uHaze!, p.haze); gl.uniform1f(u.uStorm!, p.storm);
    gl.uniform1f(u.uNight!, p.night); gl.uniform1f(u.uWind!, p.wind); gl.uniform1f(u.uTime!, p.time);
    gl.uniform2f(u.uWorldOrigin!, p.origin[0], p.origin[1]); gl.uniform2f(u.uWorldSize!, p.size[0], p.size[1]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
