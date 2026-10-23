/** Mobile WebGL2 capability detection + fallbacks (mocked contexts: desktop, Android Mali mediump-only no-float, tiny limits). */
import { describe, it, expect } from "vitest";
import { annotateShaderLog, clampDrawingBuffer, detectCapabilities, parseGlFlags, toMediump } from "../src/gl/capabilities.js";

const E = { MAX_TEXTURE_SIZE: 1, MAX_ARRAY_TEXTURE_LAYERS: 2, MAX_RENDERBUFFER_SIZE: 3, MAX_VIEWPORT_DIMS: 4, MAX_TEXTURE_IMAGE_UNITS: 5, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 6,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 7, MAX_VERTEX_ATTRIBS: 8, MAX_FRAGMENT_UNIFORM_VECTORS: 9, MAX_VERTEX_UNIFORM_VECTORS: 10, MAX_DRAW_BUFFERS: 11, MAX_COLOR_ATTACHMENTS: 12,
  RENDERER: 13, VENDOR: 14, FRAGMENT_SHADER: 20, VERTEX_SHADER: 21, HIGH_FLOAT: 22 } as const;
interface MockOpts { renderer?: string; ext?: string[]; fragHighpBits?: number; maxTex?: number; attribs?: number; units?: number; vtu?: number }
function mockGl(o: MockOpts = {}): WebGL2RenderingContext {
  const P: Record<number, unknown> = { [E.MAX_TEXTURE_SIZE]: o.maxTex ?? 16384, [E.MAX_ARRAY_TEXTURE_LAYERS]: 2048, [E.MAX_RENDERBUFFER_SIZE]: o.maxTex ?? 16384, [E.MAX_VIEWPORT_DIMS]: new Int32Array([o.maxTex ?? 16384, o.maxTex ?? 16384]),
    [E.MAX_TEXTURE_IMAGE_UNITS]: o.units ?? 16, [E.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: o.vtu ?? 16, [E.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: 32, [E.MAX_VERTEX_ATTRIBS]: o.attribs ?? 16,
    [E.MAX_FRAGMENT_UNIFORM_VECTORS]: 1024, [E.MAX_VERTEX_UNIFORM_VECTORS]: 1024, [E.MAX_DRAW_BUFFERS]: 8, [E.MAX_COLOR_ATTACHMENTS]: 8, [E.RENDERER]: o.renderer ?? "WebKit WebGL", [E.VENDOR]: "WebKit" };
  const ext = new Set(o.ext ?? ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "OES_texture_float_linear"]);
  return { ...E, getParameter: (n: number) => P[n] ?? (n === 100 ? o.renderer : undefined), getExtension: (n: string) => (n === "WEBGL_debug_renderer_info" ? (o.renderer ? { UNMASKED_RENDERER_WEBGL: 100, UNMASKED_VENDOR_WEBGL: 14 } : null) : ext.has(n) ? {} : null),
    getShaderPrecisionFormat: (st: number) => ({ rangeMin: 127, rangeMax: 127, precision: st === E.FRAGMENT_SHADER ? (o.fragHighpBits ?? 23) : 23 }) } as unknown as WebGL2RenderingContext;
}
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36";

describe("render capabilities (mobile WebGL2)", () => {
  it("parseGlFlags: comma list, unknown dropped", () => {
    expect(parseGlFlags("?gl=lowend")).toEqual(["lowend"]); expect(parseGlFlags("?x=1&gl=mediump,NOFLOAT,bogus")).toEqual(["mediump", "nofloat"]); expect(parseGlFlags("")).toEqual([]); expect(parseGlFlags(undefined)).toEqual([]);
  });
  it("desktop: highp, 2048 layers, 768 MB, DPR 3, no fallbacks/problems", () => {
    const c = detectCapabilities(mockGl(), { userAgent: DESKTOP_UA });
    expect(c.mobile).toBe(false); expect(c.precision.fragment).toBe("highp"); expect(c.atlasLayerSize).toBe(2048); expect(c.textureBudgetMB).toBe(768); expect(c.maxDpr).toBe(3);
    expect(c.floatFilter).toBe("LINEAR"); expect(c.fallbacks).toEqual([]); expect(c.problems).toEqual([]);
    expect(c.formats).toMatchObject({ scene: "RGBA8", lightmap: "RGBA8", lightmapEncode: 0.5, dataTables: "RGBA32F", lut: "RGBA8-2D-strip" });
  });
  it("Android Mali, no float exts, mediump-only: RGBA8/LDR, NEAREST, mediump + 1024 layer, 256 MB, DPR 2", () => {
    const c = detectCapabilities(mockGl({ renderer: "Mali-G57", ext: [], fragHighpBits: 0 }), { userAgent: ANDROID_UA });
    expect(c.mobile).toBe(true); expect(c.renderer).toBe("Mali-G57"); expect(c.ext).toMatchObject({ colorBufferFloat: false, colorBufferHalfFloat: false, floatLinear: false });
    expect(c.floatFilter).toBe("NEAREST"); expect(c.precision).toMatchObject({ fragmentHighp: false, fragment: "mediump" }); expect(c.atlasLayerSize).toBe(1024);
    expect(c.textureBudgetMB).toBe(256); expect(c.maxDpr).toBe(2); expect(c.formats.lightmap).toBe("RGBA8");
    expect(c.fallbacks.join("|")).toMatch(/float colour buffers.*OES_texture_float_linear.*mediump.*1024.*256 MB.*DPR capped at 2/);
  });
  it("mobile detected from the GPU name alone (desktop-mode UA)", () => { expect(detectCapabilities(mockGl({ renderer: "Adreno (TM) 610" }), { userAgent: DESKTOP_UA }).mobile).toBe(true); });
  it("?gl=lowend implies mediump + nofloat + lowmem, DPR 1", () => {
    const c = detectCapabilities(mockGl(), { userAgent: DESKTOP_UA, flags: ["lowend"] });
    expect(c.lowEnd).toBe(true); expect(c.precision.fragment).toBe("mediump"); expect(c.ext.colorBufferFloat).toBe(false); expect(c.textureBudgetMB).toBe(160); expect(c.maxDpr).toBe(1); expect(c.maxPixels).toBe(1280 * 720);
  });
  it("clamps atlas layers to MAX_TEXTURE_SIZE (power of two) and reports too-small limits", () => {
    const c = detectCapabilities(mockGl({ maxTex: 1500, attribs: 8, units: 4, vtu: 0 }), { userAgent: DESKTOP_UA });
    expect(c.atlasLayerSize).toBe(1024); expect(c.fallbacks.some((f) => f.includes("MAX_TEXTURE_SIZE 1500"))).toBe(true);
    expect(c.problems).toHaveLength(3);
  });
  it("clampDrawingBuffer: DPR cap, pixel budget, GPU limits", () => {
    const lim = (n: number) => ({ maxTextureSize: n, maxRenderbufferSize: n, maxViewport: [n, n] as [number, number] }) as never;
    expect(clampDrawingBuffer(412, 915, 3, { maxDpr: 2, maxPixels: 1e9, limits: lim(16384) })).toEqual({ w: 824, h: 1830, dpr: 2 });
    const b = clampDrawingBuffer(1280, 720, 2, { maxDpr: 3, maxPixels: 1280 * 720, limits: lim(16384) }); expect(b.w * b.h).toBeLessThanOrEqual(1280 * 720 + 2000); expect(b.dpr).toBeCloseTo(1, 2);
    const c = clampDrawingBuffer(3000, 1000, 2, { maxDpr: 3, maxPixels: 1e9, limits: lim(4096) }); expect(c.w).toBeLessThanOrEqual(4096); expect(c.h).toBeLessThanOrEqual(4096);
  });
  it("toMediump: default float -> mediump, uniforms pinned highp (VS/FS link match), ints/samplers untouched", () => {
    const fs = "#version 300 es\nprecision highp float; precision highp int;\nuniform highp sampler2DArray uA; uniform int uMode; uniform vec4 uC, uD; uniform mat3 uM; uniform mediump float uK;\nout vec4 o; void main(){ o = uC; }";
    const m = toMediump(fs);
    expect(m).toContain("precision mediump float;"); expect(m).toContain("precision highp int;"); expect(m).toContain("uniform highp sampler2DArray uA;");
    expect(m).toContain("uniform int uMode;"); expect(m).toContain("uniform highp vec4 uC, uD;"); expect(m).toContain("uniform highp mat3 uM;"); expect(m).toContain("uniform mediump float uK;");
    expect(m).not.toMatch(/precision highp float/);
  });
  it("annotateShaderLog marks the failing source line", () => {
    const out = annotateShaderLog("a\nb\nc bad\nd", "ERROR: 0:3: 'x' : undeclared");
    expect(out).toMatch(/>\s+3\| c bad/); expect(out).toMatch(/2\| b/);
  });
});
