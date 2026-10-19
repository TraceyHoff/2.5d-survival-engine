import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadManifest, validateAssetFiles, type AssetRegistry, type IdLock } from "./manifest.js";
import { DEFAULT_MANIFEST, FIXTURE_MANIFEST } from "./paths.js";

/** Node-only helpers (import "@engine/assets/node"). */
export const ASSETS_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PACK_DIR = ASSETS_ROOT + "pack/";
export const FIXTURE_DIR = ASSETS_ROOT + "sample/";
/** Load a manifest file plus the ids.lock.json beside it (if present). */
export function loadManifestFile(path: string): ReturnType<typeof loadManifest> & { dir: string } {
  const dir = path.replace(/[^/]*$/, ""); const json = JSON.parse(readFileSync(path, "utf8"));
  const lockPath = dir + "ids.lock.json"; const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) as IdLock : undefined;
  return { ...loadManifest(json, lock ? { lock } : {}), dir };
}
/** The default content manifest (art pack). */
export const loadDefaultManifest = () => loadManifestFile(ASSETS_ROOT + DEFAULT_MANIFEST);
/** The placeholder test fixture. */
export const loadFixtureManifest = () => loadManifestFile(ASSETS_ROOT + FIXTURE_MANIFEST);

/** PNG/WebP pixel size from the file header (undefined if not a readable PNG/WebP). */
export function imageSizeOf(path: string): { w: number; h: number } | undefined {
  try {
    const b = readFileSync(path);
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    }
  } catch { /* unreadable */ }
  return undefined;
}
/** validateAssetFiles against the filesystem; manifest paths resolve relative to baseDir. */
export function validateAssetFilesOnDisk(reg: AssetRegistry, baseDir: string): string[] {
  const abs = (p: string) => (p.startsWith("/") ? p : baseDir.replace(/\/?$/, "/") + p);
  return validateAssetFiles(reg, { exists: (p) => existsSync(abs(p)), imageSize: (p) => imageSizeOf(abs(p)) });
}
