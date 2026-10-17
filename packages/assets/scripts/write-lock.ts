import { readFileSync, writeFileSync } from "node:fs";
import { loadManifest } from "../src/index.js";
const dir = new URL("../sample/", import.meta.url).pathname;
const { lock } = loadManifest(JSON.parse(readFileSync(dir + "manifest.json", "utf8")));
writeFileSync(dir + "ids.lock.json", JSON.stringify(lock, null, 2) + "\n");
