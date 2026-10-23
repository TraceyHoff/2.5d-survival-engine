// Updates pack/ids.lock.json for the real art pack (Cozy-Wild) + its sub-manifests (ui kit, branding, customization). Keeps every existing id and appends new keys (never renumbers).
// Usage: tsx packages/assets/scripts/write-lock-pack.ts [manifestDir=packages/assets/pack]
// The first run seeds the lock from sample/ids.lock.json so ids shared with the placeholder sample stay identical.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadManifest, mergeManifests, type ManifestJson } from "../src/index.js";
const here = new URL("../", import.meta.url).pathname;
const dir = (process.argv[2] ?? here + "pack").replace(/\/?$/, "/");
const lockPath = dir + "ids.lock.json";
const prev = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : JSON.parse(readFileSync(here + "sample/ids.lock.json", "utf8"));
// One lock for the merged runtime manifest: pack + the sub-manifests the client loads (apps/client/src/view.ts MANIFEST_INDEX).
const root = here + "../../";
const SUBS: [string, string][] = [["ui-kit", root + "assets/ui/kit/manifest.ui.kit.json"], ["branding", root + "assets/ui/branding/manifest.branding.json"], ["customization", dir + "customization/manifest.customization.json"]];
const frags = [{ name: "pack", manifest: JSON.parse(readFileSync(dir + "manifest.json", "utf8")) as ManifestJson },
  ...SUBS.filter(([, f]) => existsSync(f)).map(([name, f]) => ({ name, manifest: JSON.parse(readFileSync(f, "utf8")) as ManifestJson }))];
const merged = mergeManifests(frags);
if (merged.collisions.length) { console.error(`${merged.collisions.length} duplicate keys across sub-manifests`, merged.collisions.slice(0, 10)); process.exit(1); }
const { lock } = loadManifest(merged.manifest, { lock: prev });
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
console.log(`${lockPath} updated`);
