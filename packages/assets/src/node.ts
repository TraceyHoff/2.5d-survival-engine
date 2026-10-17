import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadManifest, type IdLock } from "./manifest.js";
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
