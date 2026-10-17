/** Thin WebGL2 helpers: shader compilation and per-frame stats. */
export interface FrameStats { drawCalls: number; sprites: number; lights: number; tiles: number; chunks: number; particles: number; cpuMs: number }
export const newStats = (): FrameStats => ({ drawCalls: 0, sprites: 0, lights: 0, tiles: 0, chunks: 0, particles: 0, cpuMs: 0 });

export function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    throw new Error(`[${label}] shader compile error:\n${log ?? ""}`);
  }
  return s;
}

export interface Program { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string, label: string): Program {
  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram failed");
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs, label + ".vs"));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs, label + ".fs"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`[${label}] link error: ${gl.getProgramInfoLog(prog) ?? ""}`);
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (info) u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, u };
}

/** Shared GLSL: camera transform from iso px to clip space, and the depth mapping. */
export const GLSL_COMMON = /* glsl */ `
uniform vec4 uView;   // (camX, camY, 2*zoom/w, -2*zoom/h)
uniform vec2 uDepth;  // (keyMin, 1/keyRange)
vec2 isoToClip(vec2 iso) { return (iso - uView.xy) * uView.zw; }
float keyToNdc(float key) { return 1.0 - 2.0 * clamp((key - uDepth.x) * uDepth.y, 0.0, 1.0) * 0.999; }
`;

export function createTexture(gl: WebGL2RenderingContext, w: number, h: number, internal: number, format: number, type: number, filter: number): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error("createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
