/**
 * KTX2 (Basis Universal) transcoding. The Basis transcoder (Apache-2.0, Binomial LLC; vendored from three.js r170
 * examples/jsm/libs/basis, see vendor/basis/README.md) lives in packages/render/vendor/basis and is loaded lazily on the
 * first KTX2 request: no package.json dependency. Colour pages are ETC1S, masks UASTC; emissive is sRGB, the rest linear.
 * Transcode target by probe: ASTC 4x4 > ETC2 (RGBA8 EAC) > BPTC (BC7) > S3TC (DXT5) > PNG fallback (null).
 */
import type { CompressedTextureSupport } from "../gl/capabilities.js";

export type Ktx2Target = "astc" | "etc2" | "bptc" | "s3tc";
export interface Ktx2Image { width: number; height: number; levels: ArrayBufferView[]; internalFormat: number; target: Ktx2Target }
export type Ktx2Transcoder = (data: ArrayBuffer, target: Ktx2Target, srgb?: boolean) => Promise<Ktx2Image>;

/** basis transcoder_texture_format ids */
export const BASIS_FORMAT: Record<Ktx2Target, number> = { etc2: 1, s3tc: 3, bptc: 6, astc: 10 };
/** GL internal formats [linear, sRGB] per target */
export const GL_FORMAT: Record<Ktx2Target, [number, number]> = { astc: [0x93b0, 0x93d0], etc2: [0x9278, 0x9279], bptc: [0x8e8c, 0x8e8d], s3tc: [0x83f3, 0x8c4f] };
/** bytes per 4x4 block (all targets here are 16-byte blocks) */
export const blockBytes = (w: number, h: number): number => Math.ceil(w / 4) * Math.ceil(h / 4) * 16;

let transcoder: Ktx2Transcoder | null = null;
let enabled = false;
/** Install a transcoder (IsoRenderer installs basisTranscoder unless ?ktx2=0 / gl=safe). null disables KTX2 (PNG only). */
export function setKtx2Transcoder(t: Ktx2Transcoder | null): void { transcoder = t; enabled = t !== null; }

/** Best transcode target for this GPU, or null for the PNG fallback (disabled, or no compressed support). */
export function ktx2Target(c: CompressedTextureSupport): Ktx2Target | null {
  if (!enabled) return null;
  return c.astc ? "astc" : c.etc2 ? "etc2" : c.bptc ? "bptc" : c.s3tc ? "s3tc" : null;
}

/** URL to load for a page: its manifest `ktx2` twin (string) when usable, else `x.png -> x.ktx2` if `available`, else the PNG. */
export function pickTextureUrl(pngUrl: string, c: CompressedTextureSupport, ktx2?: string | ((url: string) => boolean)): string {
  if (!ktx2Target(c)) return pngUrl;
  if (typeof ktx2 === "string") return ktx2;
  const k = pngUrl.replace(/\.png$/i, ".ktx2");
  return k !== pngUrl && (!ktx2 || ktx2(k)) ? k : pngUrl;
}

interface BasisKtx2File { isValid(): boolean; getWidth(): number; getHeight(): number; getLevels(): number; startTranscoding(): boolean; getImageTranscodedSizeInBytes(l: number, layer: number, face: number, f: number): number; transcodeImage(dst: Uint8Array, l: number, layer: number, face: number, f: number, flags: number, ch0: number, ch1: number): boolean; close(): void; delete(): void }
interface BasisModule { initializeBasis(): void; KTX2File: new (b: Uint8Array) => BasisKtx2File }
let basis: Promise<BasisModule> | null = null;
/** Lazily fetch + instantiate the vendored transcoder (classic emscripten script exposing `BASIS`). */
function loadBasis(): Promise<BasisModule> {
  basis ??= (async () => {
    const js = new URL("../../vendor/basis/basis_transcoder.js", import.meta.url).href;
    const wasm = new URL("../../vendor/basis/basis_transcoder.wasm", import.meta.url).href;
    const [src, bin] = await Promise.all([fetch(js).then((r) => r.text()), fetch(wasm).then((r) => r.arrayBuffer())]);
    const factory = new Function(`${src}\n;return BASIS;`)() as (o: { wasmBinary: ArrayBuffer }) => Promise<BasisModule>;
    const m = await factory({ wasmBinary: bin }); m.initializeBasis(); return m;
  })();
  basis.catch(() => { basis = null; });
  return basis;
}

/** Default transcoder: vendored Basis, all mip levels of layer 0. */
export const basisTranscoder: Ktx2Transcoder = async (data, target, srgb = false) => {
  const m = await loadBasis(); const f = new m.KTX2File(new Uint8Array(data));
  try {
    if (!f.isValid() || !f.startTranscoding()) throw new Error("invalid KTX2");
    const fmt = BASIS_FORMAT[target]; const levels: ArrayBufferView[] = [];
    for (let l = 0; l < f.getLevels(); l++) { const dst = new Uint8Array(f.getImageTranscodedSizeInBytes(l, 0, 0, fmt)); if (!f.transcodeImage(dst, l, 0, 0, fmt, 0, -1, -1)) throw new Error(`transcode level ${l}`); levels.push(dst); }
    return { width: f.getWidth(), height: f.getHeight(), levels, internalFormat: GL_FORMAT[target][srgb ? 1 : 0], target };
  } finally { f.close(); f.delete(); }
};

/** Load + transcode a KTX2 page; null (caller uses the PNG) when disabled, unsupported or on any failure. */
export async function loadKtx2(url: string, c: CompressedTextureSupport, srgb = false, fetcher: (u: string) => Promise<ArrayBuffer> = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }): Promise<Ktx2Image | null> {
  const t = ktx2Target(c); if (!t) return null;
  try { return await (transcoder ?? basisTranscoder)(await fetcher(url), t, srgb); } catch (e) { warnOnce(url, e); return null; }
}

/** Transcode level 0 of a KTX2 (typically a UASTC mask) to straight RGBA8 pixels (basis cTFRGBA32 = 13); null on failure. */
export async function loadKtx2Rgba(url: string, fetcher: (u: string) => Promise<ArrayBuffer> = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  if (!enabled) return null;
  try {
    const m = await loadBasis(); const f = new m.KTX2File(new Uint8Array(await fetcher(url)));
    try {
      if (!f.isValid() || !f.startTranscoding()) return null;
      const dst = new Uint8Array(f.getImageTranscodedSizeInBytes(0, 0, 0, 13));
      if (!f.transcodeImage(dst, 0, 0, 0, 13, 0, -1, -1)) return null;
      return { width: f.getWidth(), height: f.getHeight(), data: dst };
    } finally { f.close(); f.delete(); }
  } catch (e) { warnOnce(url, e); return null; }
}

let warned = 0;
function warnOnce(url: string, e: unknown): void { if (warned++ < 3) console.warn(`[render] ktx2 ${url}: ${e instanceof Error ? e.message : String(e)}`); }
