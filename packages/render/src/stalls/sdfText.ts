/**
 * World-space SDF text (stall signs, price tags, badge labels) in Fredoka.
 *
 * Primary source: Art's shipped Fredoka MTSDF atlases (stalls/fonts/fredoka_{regular,bold}_mtsdf.{png,json}, BMFont JSON,
 * fieldType mtsdf, distanceRange 4, em 48) loaded with parseBmFont: the shader takes median(r,g,b) for the glyph edge and
 * uses A (true SDF) for effects (optional halo). buildRuntimeSdf (runtime-rasterised single-channel SDF from a CSS font)
 * stays only as a fallback when the atlas is missing.
 */
import { createProgram, type Program } from "../gl/util.js";

export interface GlyphInfo { u0: number; v0: number; u1: number; v1: number; w: number; h: number; xoff: number; yoff: number; adv: number }
/** Glyph metrics in units of the atlas em size `px` (scale by sizePx / px). */
export interface SdfFontData { px: number; lineH: number; base: number; glyphs: Map<number, GlyphInfo>; image: TexImageSource | null; width: number; height: number; msdf: boolean;
  /** mtsdf: A channel holds a true SDF (used for halo effects). */ mtsdf?: boolean; /** distance range in atlas px */ pxRange?: number }

/** BMFont JSON (msdf-bmfont / msdfgen layout: pages, chars[], info.size, common.{lineHeight,base,scaleW,scaleH}, distanceField). */
export interface BmFontJson {
  info: { size: number; padding?: number[] }; common: { lineHeight: number; base: number; scaleW: number; scaleH: number };
  distanceField?: { fieldType: string; distanceRange: number };
  chars: { id: number; x: number; y: number; width: number; height: number; xoffset: number; yoffset: number; xadvance: number; page?: number }[];
}
/** BMFont MTSDF/MSDF atlas -> SdfFontData (metrics in atlas px at em info.size; single page). */
export function parseBmFont(json: BmFontJson, image: TexImageSource | null): SdfFontData {
  const W = json.common.scaleW, H = json.common.scaleH; const glyphs = new Map<number, GlyphInfo>();
  for (const c of json.chars) glyphs.set(c.id, { u0: c.x / W, v0: c.y / H, u1: (c.x + c.width) / W, v1: (c.y + c.height) / H, w: c.width, h: c.height, xoff: c.xoffset, yoff: c.yoffset, adv: c.xadvance });
  const ft = json.distanceField?.fieldType ?? "sdf";
  return { px: json.info.size, lineH: json.common.lineHeight, base: json.common.base, glyphs, image, width: W, height: H,
    msdf: ft === "msdf" || ft === "mtsdf", mtsdf: ft === "mtsdf", pxRange: json.distanceField?.distanceRange ?? 4 };
}
/** Fetch + decode a BMFont MTSDF atlas (JSON URL; page PNG resolved next to it). Browser only. */
export async function loadBmFont(jsonUrl: string): Promise<SdfFontData> {
  const json = await (await fetch(jsonUrl)).json() as BmFontJson & { pages: string[] };
  const page = new URL(json.pages[0]!, new URL(jsonUrl, location.href)).href;
  const img = await createImageBitmap(await (await fetch(page)).blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  return parseBmFont(json, img);
}
/** Ellipsis fallback: "…" -> "..." when the font has no U+2026 (Latin-1 atlases). */
export const fontText = (font: Pick<SdfFontData, "glyphs">, text: string): string => (font.glyphs.has(0x2026) ? text : text.replace(/\u2026/g, "..."));

/** Exact squared EDT (Felzenszwalb-Huttenlocher) of a binary grid: 0 inside `on`, inf outside. */
function edt(grid: Float64Array, w: number, h: number): void {
  const f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const pass = (n: number, get: (i: number) => number, set: (i: number, x: number) => void): void => {
    for (let i = 0; i < n; i++) f[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1]! < q) k++; d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!; }
    for (let i = 0; i < n; i++) set(i, d[i]!);
  };
  for (let x = 0; x < w; x++) pass(h, (i) => grid[i * w + x]!, (i, val) => { grid[i * w + x] = val; });
  for (let y = 0; y < h; y++) pass(w, (i) => grid[y * w + i]!, (i, val) => { grid[y * w + i] = val; });
}
/** Signed distance (px, + inside) of an alpha coverage grid (threshold 0.5), mapped to 0..255 with 0.5 at the edge. */
export function sdfFromAlpha(alpha: ArrayLike<number>, w: number, h: number, spread: number): Uint8Array {
  const INF = 1e20; const inside = new Float64Array(w * h), outside = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) { const on = alpha[i]! >= 128; outside[i] = on ? 0 : INF; inside[i] = on ? INF : 0; }
  edt(outside, w, h); edt(inside, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const sd = Math.sqrt(inside[i]!) - Math.sqrt(outside[i]!); out[i] = Math.max(0, Math.min(255, Math.round(128 + (sd / spread) * 127))); }
  return out;
}

const CHARS = Array.from({ length: 95 }, (_, i) => 32 + i).concat([0x2026, 0xd7]); // ASCII + … + ×

/** Runtime SDF atlas from a CSS font family (load Fredoka with FontFace first). Browser only (OffscreenCanvas / canvas). */
export function buildRuntimeSdf(family: string, weight: number, px = 32, pad = 6): SdfFontData {
  const cell = px + pad * 2; const cols = 16; const rows = Math.ceil(CHARS.length / cols);
  const W = cols * cell, H = rows * cell;
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const g = cv.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  g.font = `${weight} ${px}px ${family}`; g.textBaseline = "alphabetic"; g.fillStyle = "#fff";
  const asc = px * 0.8; const glyphs = new Map<number, GlyphInfo>();
  CHARS.forEach((c, i) => {
    const ch = String.fromCodePoint(c); const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
    g.fillText(ch, cx + pad, cy + pad + asc);
    glyphs.set(c, { u0: cx / W, v0: cy / H, u1: (cx + cell) / W, v1: (cy + cell) / H, w: cell, h: cell, xoff: -pad, yoff: -pad, adv: g.measureText(ch).width });
  });
  const img = g.getImageData(0, 0, W, H); const a = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) a[i] = img.data[i * 4 + 3]!;
  const sdf = sdfFromAlpha(a, W, H, pad); const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = sdf[i]!; rgba[i * 4 + 3] = 255; }
  return { px, lineH: px * 1.2, base: asc, glyphs, image: new ImageData(rgba, W, H), width: W, height: H, msdf: false };
}

/** Text width in px at sizePx (advance sum). */
export function measureText(font: Pick<SdfFontData, "px" | "glyphs">, text: string, sizePx: number): number {
  let w = 0; for (const ch of fontText(font, text)) w += font.glyphs.get(ch.codePointAt(0)!)?.adv ?? font.px * 0.5; return (w * sizePx) / font.px;
}

export interface TextRun { text: string; x: number; y: number; sizePx: number; color: [number, number, number, number]; align: "left" | "center" | "right" }

const VS = /* glsl */ `#version 300 es
precision highp float;
layout(location=0) in vec4 aPos; // iso px x0,y0,x1,y1
layout(location=1) in vec4 aUv;
layout(location=2) in vec4 aCol;
uniform vec4 uView;
out vec2 vUv; out vec4 vCol;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 p = mix(aPos.xy, aPos.zw, c); vUv = mix(aUv.xy, aUv.zw, c); vCol = aCol;
  gl_Position = vec4((p - uView.xy) * uView.zw, 0.0, 1.0);
}`;
const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vCol; uniform highp sampler2D uTex; uniform int uMsdf; uniform vec3 uLight; uniform vec4 uHalo; // halo rgb + strength (mtsdf A channel)
out vec4 o;
float median(float r, float g, float b) { return max(min(r, g), min(max(r, g), b)); }
void main() {
  vec4 t = texture(uTex, vUv); float d = uMsdf >= 1 ? median(t.r, t.g, t.b) : t.r;
  float w = max(fwidth(d), 1e-4) * 0.75; float a = smoothstep(0.5 - w, 0.5 + w, d) * vCol.a;
  // mtsdf: A = true SDF -> soft halo just outside the glyph (off when uHalo.a == 0)
  float h = uMsdf == 2 ? smoothstep(0.2, 0.5, t.a) * uHalo.a * vCol.a : 0.0;
  float oa = a + h * (1.0 - a);
  if (oa <= 0.004) discard;
  o = vec4(vCol.rgb * uLight * a + uHalo.rgb * h * (1.0 - a), oa); // premultiplied
}`;

/** Instanced SDF glyph quads, drawn over the composited frame (after IsoRenderer.render) in iso screen space. */
export class SdfTextPass {
  private prog: Program; private vao: WebGLVertexArrayObject; private vbo: WebGLBuffer; private tex: WebGLTexture | null = null;
  private data = new Float32Array(12 * 256); private n = 0; glyphsDrawn = 0;
  /** Halo colour + strength (mtsdf fonts only; 0 = off). */
  halo: [number, number, number, number] = [0, 0, 0, 0];
  constructor(private gl: WebGL2RenderingContext, public font: SdfFontData) {
    this.prog = createProgram(gl, VS, FS, "sdfText"); this.vbo = gl.createBuffer()!; this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    for (let a = 0; a < 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 48, a * 16); gl.vertexAttribDivisor(a, 1); }
    gl.bindVertexArray(null); this.upload();
  }
  private upload(): void {
    const gl = this.gl; const f = this.font; if (!f.image) return;
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, f.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  begin(): void { this.n = 0; }
  /** Queue a run; (x, y) = baseline anchor in iso px. */
  add(r: TextRun): void {
    const f = this.font; const k = r.sizePx / f.px; const w = measureText(f, r.text, r.sizePx);
    let x = r.align === "center" ? r.x - w / 2 : r.align === "right" ? r.x - w : r.x; const top = r.y - f.base * k;
    for (const ch of fontText(f, r.text)) {
      const g = f.glyphs.get(ch.codePointAt(0)!); if (!g) { x += f.px * 0.5 * k; continue; }
      if (ch !== " ") {
        if ((this.n + 1) * 12 > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
        const o = this.n++ * 12; const x0 = x + g.xoff * k, y0 = top + g.yoff * k;
        this.data.set([x0, y0, x0 + g.w * k, y0 + g.h * k, g.u0, g.v0, g.u1, g.v1, ...r.color], o);
      }
      x += g.adv * k;
    }
  }
  /** Draw queued glyphs to the bound (default) framebuffer. `light` = scene light multiplier (signs darken at night). */
  draw(viewU: Float32Array, light: [number, number, number]): void {
    const gl = this.gl; this.glyphsDrawn = this.n; if (!this.n || !this.tex) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.prog); gl.uniform4fv(this.prog.u.uView!, viewU); gl.uniform1i(this.prog.u.uMsdf!, this.font.mtsdf ? 2 : this.font.msdf ? 1 : 0); gl.uniform4fv(this.prog.u.uHalo!, this.halo); gl.uniform3fv(this.prog.u.uLight!, light);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.prog.u.uTex!, 0);
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * 12), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n); gl.bindVertexArray(null); gl.disable(gl.BLEND);
  }
}
