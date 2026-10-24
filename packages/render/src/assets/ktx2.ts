/**
 * KTX2 (Basis Universal) loader stub, behind a feature check. Nothing here transcodes yet: the Basis transcoder is
 * not a dependency (see docs/ART_KEYS_VEHICLES.md for the Art ask). Until it lands every atlas loads its PNG.
 *
 * Plan: UASTC for masks / emissive (no block artefacts on sharp mask edges), ETC1S for colour. Transcode target by
 * capability: ASTC 4x4 > ETC2 (RGBA8 EAC) > BPTC > S3TC (DXT5) > PNG/RGBA8.
 */
import type { CompressedTextureSupport } from "../gl/capabilities.js";

export type Ktx2Target = "astc" | "etc2" | "bptc" | "s3tc";
export type Ktx2Transcoder = (data: ArrayBuffer, target: Ktx2Target) => Promise<{ width: number; height: number; levels: ArrayBufferView[]; internalFormat: number }>;

let transcoder: Ktx2Transcoder | null = null;
/** Install a Basis transcoder (e.g. from a lazily loaded wasm module). Without one, ktx2Target() is always null. */
export function setKtx2Transcoder(t: Ktx2Transcoder | null): void { transcoder = t; }

/** Best transcode target for this GPU, or null to use the PNG fallback (no transcoder, no compressed support, or ?gl=safe). */
export function ktx2Target(c: CompressedTextureSupport): Ktx2Target | null {
  if (!transcoder) return null;
  return c.astc ? "astc" : c.etc2 ? "etc2" : c.bptc ? "bptc" : c.s3tc ? "s3tc" : null;
}

/** KTX2 URL for a PNG page (`atlas.png` -> `atlas.ktx2`), or the PNG itself when KTX2 cannot be used. */
export function pickTextureUrl(pngUrl: string, c: CompressedTextureSupport, available?: (url: string) => boolean): string {
  if (!ktx2Target(c)) return pngUrl;
  const k = pngUrl.replace(/\.png$/i, ".ktx2");
  return k !== pngUrl && (!available || available(k)) ? k : pngUrl;
}

/** Load a KTX2 page through the installed transcoder; resolves null (caller falls back to the PNG) on any failure. */
export async function loadKtx2(url: string, c: CompressedTextureSupport, fetcher: (u: string) => Promise<ArrayBuffer> = async (u) => (await fetch(u)).arrayBuffer()): Promise<Awaited<ReturnType<Ktx2Transcoder>> | null> {
  const t = ktx2Target(c); if (!t || !transcoder) return null;
  try { return await transcoder(await fetcher(url), t); } catch { return null; }
}
