// Updates pack/ids.lock.json for the real art pack (Cozy-Wild). Keeps every existing id and appends new keys (never renumbers).
// Usage: tsx packages/assets/scripts/write-lock-pack.ts [manifestDir=packages/assets/pack]
// The first run seeds the lock from sample/ids.lock.json so ids shared with the placeholder sample stay identical.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadManifest } from "../src/index.js";
const here = new URL("../", import.meta.url).pathname;
const dir = (process.argv[2] ?? here + "pack").replace(/\/?$/, "/");
const lockPath = dir + "ids.lock.json";
const prev = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : JSON.parse(readFileSync(here + "sample/ids.lock.json", "utf8"));
const { lock } = loadManifest(JSON.parse(readFileSync(dir + "manifest.json", "utf8")), { lock: prev });
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
console.log(`${lockPath} updated`);
