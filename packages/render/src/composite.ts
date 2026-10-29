/**
 * Composite pass (fullscreen): scene x lightmap (emissive pixels bypass darkness), optional light banding +
 * night floor, heat shimmer (UV distortion above heat Emitters), cloud shadows, fog/haze, storm darkening,
 * lightning flash, emissive-only bloom, time-of-day LUT grading (two strips blended on the GPU),
 * parametric grading, vignette. All look parameters come from StyleConfig (neutral defaults).
 */
import { createProgram, FULLSCREEN_VS, type Program } from "./gl/util.js";
import { GLSL_LUT } from "./grading.js";
import { MAX_HEAT } from "./lighting.js";
import type { StyleConfig } from "./style.js";
/** ADR-215: soft shoulder on the decoded light (max channel above 1 compressed toward 1.625, hue kept), so the larger,
 *  overlapping fire/lamp lights brighten the scene instead of blowing it out to flat yellow. */
export const LIGHT_KNEE_GLSL = /* glsl */ `vec3 lightKnee(vec3 l) { float m = max(l.r, max(l.g, l.b)); if (m <= 1.0) return l; float k = 1.0 + (m - 1.0) / (1.0 + (m - 1.0) * 1.6); return l * (k / m); }`;
/** CPU mirror of LIGHT_KNEE_GLSL (tests). */
export function lightKnee(l: readonly [number, number, number]): [number, number, number] {
  const m = Math.max(l[0], l[1], l[2]); if (m <= 1) return [l[0], l[1], l[2]]; const k = 1 + (m - 1) / (1 + (m - 1) * 1.6); return [l[0] * k / m, l[1] * k / m, l[2] * k / m];
}

const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 vUv;
uniform highp sampler2D uScene, uEmissive, uLight, uBloom, uLutA, uLutB, uShimmerTex; uniform int uHasShimmerTex;
uniform vec3 uAmbient, uFogColor, uNightTint, uLift, uGain, uFlashColor;
uniform float uFog, uHaze, uStorm, uTime, uNight, uWind, uBands, uBandMix, uNightMin, uSat, uContrast;
uniform float uBloomStrength, uLutSizeA, uLutSizeB, uLutMix, uLutStrength, uFlash, uCloudAlpha, uCloudScale, uShimmer, uShimmerScale, uShimmerSpeed;
uniform vec2 uWorldOrigin, uWorldSize, uWindDir, uCloudOffset;
uniform vec4 uHeat[${MAX_HEAT}]; uniform int uHeatCount; uniform int uTransparent;
out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
${GLSL_LUT}
${LIGHT_KNEE_GLSL}
void main() {
  vec2 wpx = uWorldOrigin + vUv * uWorldSize; // world-anchored screen pixels
  vec2 uv = vUv;
  // heat shimmer: scrolled RG offset noise, strongest just above the emitter, fading with distance/height
  if (uShimmer > 0.0) {
    float amt = 0.0;
    for (int i = 0; i < ${MAX_HEAT}; i++) { if (i >= uHeatCount) break;
      vec4 h = uHeat[i]; vec2 d = wpx - h.xy; d.y += h.z * 0.25;
      float r = length(d * vec2(1.0, 0.7)) / (h.z * 0.6);
      amt += h.w * max(0.0, 1.0 - r) * smoothstep(0.0, 0.25 * h.z, -d.y + 0.25 * h.z);
    }
    if (amt > 0.001) {
      vec2 q = wpx * 0.08 * uShimmerScale + vec2(0.0, uTime * 3.0 * uShimmerSpeed);
      vec2 off = uHasShimmerTex == 1 ? texture(uShimmerTex, q * 0.125).rg - 0.5 : vec2(vnoise(q) - 0.5, vnoise(q + 17.3) - 0.5);
      uv += off * amt * uShimmer * 6.0 / uWorldSize * vec2(1.0, -1.0);
    }
  }
  vec4 scene4 = texture(uScene, uv); vec3 scene = scene4.rgb;
  // transparent canvas: the scene is premultiplied over (0,0,0,0); grade the straight colour, re-premultiply at the end
  float alpha = 1.0; if (uTransparent == 1) { alpha = scene4.a; scene = alpha > 0.0 ? scene / alpha : vec3(0.0); }
  float emis = clamp(texture(uEmissive, uv).r, 0.0, 1.0);
  vec3 light = lightKnee(texture(uLight, uv).rgb * 2.0);
  float ll = dot(light, vec3(0.299, 0.587, 0.114));
  if (uNightMin > 0.0 && ll < uNightMin) light = mix(light, uNightTint * (uNightMin / max(0.001, dot(uNightTint, vec3(0.299, 0.587, 0.114)))), 1.0 - ll / uNightMin);
  if (uBands > 0.5) { vec3 q = floor(light * uBands + 0.5) / uBands; light = mix(light, q, uBandMix); }
  // cloud shadows: large tileable noise scrolled by wind, dims only the ambient/sun part
  if (uCloudAlpha > 0.0) {
    float c = smoothstep(0.42, 0.7, fbm((wpx + uCloudOffset) / uCloudScale));
    light *= 1.0 - uCloudAlpha * c;
  }
  // emissive pixels bypass scene lighting (natural flame colour, no light-colour tint)
  vec3 col = mix(scene * light, scene, emis);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l), 0.35 * uStorm) * (1.0 - 0.3 * uStorm);
  vec2 wp = wpx / 380.0;
  float n = fbm(wp + vec2(uTime * (0.04 + 0.12 * uWind), uTime * 0.015));
  float fogAmt = clamp(uFog * (0.45 + 0.75 * n), 0.0, 0.92);
  vec3 fogCol = uFogColor * (0.3 + 0.7 * clamp(dot(uAmbient, vec3(0.33)), 0.0, 1.0)) + light * 0.06;
  col = mix(col, fogCol, fogAmt);
  col += vec3(1.0, 0.6, 0.35) * uHaze * 0.05;
  col += uFlashColor * uFlash * (0.35 + 0.65 * scene);
  if (uBloomStrength > 0.0) col += texture(uBloom, vUv).rgb * uBloomStrength;
  if (uLutStrength > 0.0 && uLutSizeA > 1.0) {
    vec3 g = lutSample(uLutA, col, uLutSizeA);
    if (uLutMix > 0.0 && uLutSizeB > 1.0) g = mix(g, lutSample(uLutB, col, uLutSizeB), uLutMix);
    col = mix(col, g, uLutStrength);
  }
  l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  col = col * uGain + uLift;
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * (0.25 + 0.5 * uNight);
  o = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}`;

/** `?gl=safe` composite: scene x lightmap (emissive bypass) straight to the screen; no bloom, LUT, fog or noise. */
const SAFE_FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; uniform highp sampler2D uScene, uEmissive, uLight; uniform int uTransparent; out vec4 o;
${LIGHT_KNEE_GLSL}
void main() {
  vec4 s4 = texture(uScene, vUv); vec3 scene = s4.rgb; float a = uTransparent == 1 ? s4.a : 1.0; float emis = clamp(texture(uEmissive, vUv).r, 0.0, 1.0);
  vec3 light = lightKnee(texture(uLight, vUv).rgb * 2.0);
  // premultiplied scene stays premultiplied: scene*light <= a*light, clamp to a
  o = vec4(min(mix(scene * light, scene, emis), vec3(a)), a);
}`;

export interface LutBinding { tex: WebGLTexture; size: number }
export interface CompositeParams {
  ambient: readonly [number, number, number]; fog: number; haze: number; storm: number; night: number; wind: number; time: number;
  origin: readonly [number, number]; size: readonly [number, number]; style: StyleConfig;
  fogColor?: readonly [number, number, number];
  bloom?: WebGLTexture | null; bloomStrength?: number;
  lutA?: LutBinding | null; lutB?: LutBinding | null; lutMix?: number;
  flash?: number; cloudOffset?: readonly [number, number]; cloudAlpha?: number;
  heat?: Float32Array; heatCount?: number;
  /** Tileable RG offset noise (Art's heat_shimmer_rg); procedural noise when absent. */
  shimmerTex?: WebGLTexture | null;
  /** Premultiplied-alpha output with the scene's coverage alpha (IsoRendererOptions.transparent). */
  transparent?: boolean;
}

export class CompositePass {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private dummy: WebGLTexture;
  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, FULLSCREEN_VS, FS, "composite");
    this.vao = gl.createVertexArray()!;
    this.dummy = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    // single level: the default NEAREST_MIPMAP_LINEAR min filter would make the dummy incomplete
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
  }
  private safeProg: Program | null = null;
  /** Direct scene x light composite (safe mode). */
  drawSafe(scene: WebGLTexture, emissive: WebGLTexture, light: WebGLTexture, transparent = false): void {
    const gl = this.gl; const pr = (this.safeProg ??= createProgram(gl, FULLSCREEN_VS, SAFE_FS, "composite-safe"));
    gl.useProgram(pr.prog);
    [scene, emissive, light].forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(pr.u[["uScene", "uEmissive", "uLight"][i]!] ?? null, i); });
    gl.uniform1i(pr.u.uTransparent ?? null, transparent ? 1 : 0);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  }
  draw(scene: WebGLTexture, emissive: WebGLTexture, light: WebGLTexture, p: CompositeParams): void {
    const gl = this.gl; const { u } = this.prog; const st = p.style;
    gl.useProgram(this.prog.prog);
    const bind = (unit: number, t: WebGLTexture, name: string): void => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name] ?? null, unit); };
    bind(0, scene, "uScene"); bind(1, emissive, "uEmissive"); bind(2, light, "uLight");
    bind(3, p.bloom ?? this.dummy, "uBloom"); bind(4, p.lutA?.tex ?? this.dummy, "uLutA"); bind(5, p.lutB?.tex ?? this.dummy, "uLutB"); bind(6, p.shimmerTex ?? this.dummy, "uShimmerTex"); gl.uniform1i(u.uHasShimmerTex ?? null, p.shimmerTex ? 1 : 0);
    const v3 = (n: string, v: readonly number[]): void => gl.uniform3f(u[n] ?? null, v[0]!, v[1]!, v[2]!);
    const f = (n: string, v: number): void => gl.uniform1f(u[n] ?? null, v);
    v3("uAmbient", p.ambient); v3("uFogColor", p.fogColor ?? st.fogColor); v3("uNightTint", st.nightTint); v3("uLift", st.grading.lift); v3("uGain", st.grading.gain);
    v3("uFlashColor", st.lightning.color);
    f("uFog", p.fog); f("uHaze", p.haze); f("uStorm", p.storm); f("uNight", p.night); f("uWind", p.wind); f("uTime", p.time);
    f("uBands", st.lightBands); f("uBandMix", st.bandMix); f("uNightMin", st.nightMinBrightness);
    f("uSat", st.grading.saturation); f("uContrast", st.grading.contrast);
    f("uBloomStrength", p.bloom ? (p.bloomStrength ?? 0) : 0);
    f("uLutSizeA", p.lutA?.size ?? 0); f("uLutSizeB", p.lutB?.size ?? 0); f("uLutMix", p.lutMix ?? 0); f("uLutStrength", p.lutA ? st.gradingLut.strength : 0);
    f("uFlash", p.flash ?? 0); f("uCloudAlpha", p.cloudAlpha ?? 0); f("uCloudScale", Math.max(64, st.clouds.scalePx));
    gl.uniform2f(u.uCloudOffset ?? null, p.cloudOffset?.[0] ?? 0, p.cloudOffset?.[1] ?? 0);
    f("uShimmer", st.shimmer.strength); f("uShimmerScale", st.shimmer.scale); f("uShimmerSpeed", st.shimmer.speed);
    gl.uniform1i(u.uHeatCount ?? null, p.heatCount ?? 0); gl.uniform1i(u.uTransparent ?? null, p.transparent ? 1 : 0);
    if (p.heat && (p.heatCount ?? 0) > 0) gl.uniform4fv(u.uHeat ?? null, p.heat);
    gl.uniform2f(u.uWorldOrigin ?? null, p.origin[0], p.origin[1]); gl.uniform2f(u.uWorldSize ?? null, p.size[0], p.size[1]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
