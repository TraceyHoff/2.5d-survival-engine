// Updates sample/ids.lock.json: keeps every existing id, appends new keys (never renumbers).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadManifest } from "../src/index.js";
const dir = new URL("../sample/", import.meta.url).pathname;
const lockPath = dir + "ids.lock.json";
const prev = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
const { lock } = loadManifest(JSON.parse(readFileSync(dir + "manifest.json", "utf8")), { lock: prev });
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
console.log("ids.lock.json updated");
