/**
 * Weather: maps the Weather resource (kind + intensity) to smoothed visual levels
 * (rain, snow, fog, wind, storm darkening), and draws GPU-instanced precipitation.
 * Particles have NO per-particle CPU state: positions are a pure function of gl_InstanceID,
 * time and camera, so 6k streaks cost one draw call and zero uploads.
 */
import { createProgram, type FrameStats, type Program } from "./gl/util.js";

export interface WeatherLevels { rain: number; snow: number; fog: number; wind: number; storm: number }

/** Default kind ids (gameplay WeatherKind: Clear 0, Rain 1, Storm 2, Snow 3, Fog 4). Gameplay owns the values. */
export const enum WeatherKindId { Clear = 0, Rain = 1, Storm = 2, Snow = 3, Fog = 4 }

/** Visual levels at intensity 1 for one weather kind; scaled by intensity (fog has a floor). */
export interface WeatherVisual { rain: number; snow: number; fog: number; wind: number; storm: number; fogFloor?: number }
/** kind -> visuals. Replace/extend with setWeatherTable() when gameplay adds kinds; unknown kinds fall back to `fallback`. */
export const DEFAULT_WEATHER_TABLE: Record<number, WeatherVisual> = {
  [WeatherKindId.Clear]: { rain: 0, snow: 0, fog: 0, wind: 0, storm: 0 },
  [WeatherKindId.Rain]: { rain: 1, snow: 0, fog: 0.35, wind: 0.35, storm: 0.15 },
  [WeatherKindId.Storm]: { rain: 1, snow: 0, fog: 0.5, wind: 1, storm: 0.45 },
  [WeatherKindId.Snow]: { rain: 0, snow: 1, fog: 0.3, wind: 0.2, storm: 0 },
  [WeatherKindId.Fog]: { rain: 0, snow: 0, fog: 1, wind: 0.05, storm: 0, fogFloor: 0.2 },
};
let table: Record<number, WeatherVisual> = DEFAULT_WEATHER_TABLE;
let fallback: WeatherVisual = DEFAULT_WEATHER_TABLE[WeatherKindId.Clear]!;
export function setWeatherTable(t: Record<number, WeatherVisual>, fb: WeatherVisual = DEFAULT_WEATHER_TABLE[WeatherKindId.Clear]!): void { table = t; fallback = fb; }

export function weatherTargets(kind: number, intensity: number): WeatherLevels {
  const i = Math.max(0, Math.min(1, intensity));
  const v = table[kind] ?? fallback;
  return { rain: v.rain * i, snow: v.snow * i, fog: Math.max(v.fogFloor ?? 0, v.fog * i), wind: v.wind * i, storm: v.storm * i };
}

export class WeatherState implements WeatherLevels {
  rain = 0; snow = 0; fog = 0; wind = 0; storm = 0;
  /** Seconds to reach ~63% of the way. */
  timeConstant = 1.5;
  update(target: WeatherLevels, dt: number): void {
    const k = 1 - Math.exp(-dt / this.timeConstant);
    this.rain += (target.rain - this.rain) * k; this.snow += (target.snow - this.snow) * k;
    this.fog += (target.fog - this.fog) * k; this.wind += (target.wind - this.wind) * k; this.storm += (target.storm - this.storm) * k;
  }
  snap(target: WeatherLevels): void { Object.assign(this, target); }
}

const VS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
uniform vec2 uRes;       // drawing buffer px
uniform vec2 uCam;       // camera iso px * zoom (parallax scroll)
uniform float uTime, uWind, uScale;
uniform int uMode;       // 0 rain streaks, 1 rain splashes, 2 snow
out vec2 vLocal; out float vAlpha;
uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rnd(uint id, uint salt) { return float(hash(id * 4u + salt) & 0xffffffu) / 16777216.0; }
void main() {
  uint id = uint(gl_InstanceID);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vLocal = c;
  float r0 = rnd(id, 0u), r1 = rnd(id, 1u), r2 = rnd(id, 2u);
  vec2 span = uRes * 1.2;
  vec2 p; vec2 corner;
  if (uMode == 0) {
    float speed = (1.1 + 0.6 * r2) * uRes.y * 1.1;      // px/s
    float slant = uWind * 0.45 + 0.08;
    vec2 dir = normalize(vec2(slant, 1.0));
    float y = fract(r1 + uTime * speed / span.y) * span.y;
    float x = fract(r0 + (uCam.x * (0.6 + 0.4 * r2)) / span.x) * span.x + y * slant;
    p = vec2(mod(x, span.x), y) - uRes * 0.1;
    float len = (14.0 + 18.0 * r2) * uScale, wid = 0.9 * uScale;
    vec2 side = vec2(dir.y, -dir.x);
    corner = dir * c.y * len + side * c.x * wid;
    vAlpha = 0.25 + 0.35 * r2;
  } else if (uMode == 1) {
    float rate = 1.6 + r2;
    float ph = uTime * rate + r0 * 10.0;
    uint cyc = uint(floor(ph));
    float t = fract(ph);
    p = vec2(rnd(id + cyc * 7919u, 3u), rnd(id + cyc * 104729u, 1u)) * uRes;
    float rad = (2.0 + 7.0 * t) * uScale;
    corner = c * vec2(rad, rad * 0.5);
    vAlpha = (1.0 - t) * 0.5;
  } else {
    float speed = (0.08 + 0.07 * r2) * uRes.y;
    float y = fract(r1 + uTime * speed / span.y) * span.y;
    float sway = sin(uTime * (0.8 + r2) + r0 * 40.0) * 18.0 * uScale + uTime * uWind * 40.0 * uScale;
    float x = fract(r0 + (uCam.x * (0.6 + 0.4 * r2)) / span.x) * span.x + sway;
    p = vec2(mod(x, span.x), y) - uRes * 0.1;
    float s = (1.2 + 2.2 * r2) * uScale;
    corner = c * s;
    vAlpha = 0.55 + 0.4 * r2;
  }
  vec2 px = p + corner;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;
const FS = /* glsl */ `#version 300 es
precision highp float; precision highp int;
in vec2 vLocal; in float vAlpha;
uniform int uMode; uniform vec3 uTint; uniform float uLevel;
out vec4 o;
void main() {
  float a;
  if (uMode == 0) a = (1.0 - abs(vLocal.x)) * smoothstep(-1.0, -0.2, vLocal.y);
  else if (uMode == 1) { float d = length(vLocal); a = smoothstep(0.65, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d)); }
  else { float d = dot(vLocal, vLocal); a = 1.0 - smoothstep(0.3, 1.0, d); }
  o = vec4(uTint, a * vAlpha * clamp(uLevel * 1.5, 0.0, 1.0));
}`;

export class WeatherPass {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  maxRain = 6000; maxSnow = 3500; maxSplash = 500;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, "weather");
    this.vao = gl.createVertexArray()!;
  }

  /** Drawn on top of the composited image (screen space). */
  draw(w: number, h: number, camX: number, camY: number, scale: number, levels: WeatherLevels, time: number,
    ambient: readonly [number, number, number], stats: FrameStats): void {
    if (levels.rain < 0.01 && levels.snow < 0.01) return;
    const gl = this.gl; const { u } = this.prog;
    gl.useProgram(this.prog.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const areaScale = Math.min(2, (w * h) / (1600 * 900));
    gl.uniform2f(u.uRes!, w, h); gl.uniform2f(u.uCam!, camX, camY);
    gl.uniform1f(u.uTime!, time); gl.uniform1f(u.uWind!, levels.wind); gl.uniform1f(u.uScale!, Math.max(1, scale));
    // precipitation is lit by ambient, never fully black
    const lum = (c: number): number => 0.35 + 0.65 * Math.min(1, c);
    const draws: [number, number, number][] = [
      [0, Math.round(this.maxRain * levels.rain * areaScale), levels.rain],
      [1, Math.round(this.maxSplash * levels.rain * areaScale), levels.rain],
      [2, Math.round(this.maxSnow * levels.snow * areaScale), levels.snow],
    ];
    for (const [mode, count, level] of draws) {
      if (count <= 0) continue;
      gl.uniform1i(u.uMode!, mode); gl.uniform1f(u.uLevel!, level);
      if (mode === 2) gl.uniform3f(u.uTint!, lum(ambient[0]) * 1.0, lum(ambient[1]) * 1.0, lum(ambient[2]) * 1.05);
      else gl.uniform3f(u.uTint!, lum(ambient[0]) * 0.75, lum(ambient[1]) * 0.85, lum(ambient[2]) * 1.0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      stats.drawCalls++; stats.particles += count;
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
