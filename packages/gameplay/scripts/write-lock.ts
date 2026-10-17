/** Regenerates data/ids.lock.json (append-only) from the JSON tables. Run: pnpm --filter @engine/gameplay lock:ids */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_ID_LOCK, DEFAULT_RAW_DEFS, loadDefs } from "../src/index.js";

const { lock } = loadDefs(DEFAULT_RAW_DEFS, { lock: DEFAULT_ID_LOCK });
const sorted = Object.fromEntries(Object.entries(lock).map(([t, m]) => [t, Object.fromEntries(Object.entries(m).sort((a, b) => a[1] - b[1]))]));
writeFileSync(fileURLToPath(new URL("../data/ids.lock.json", import.meta.url)), JSON.stringify(sorted, null, 2) + "\n");
console.log("wrote ids.lock.json");
