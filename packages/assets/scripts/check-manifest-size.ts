// ADR-138 CI guard: fails if any manifest*.json is over 20 MiB (GitHub warns at 50 MB, rejects at 100 MB). Fix: pnpm art:shard-manifest <file>.
import { statSync } from "node:fs"; import { join, relative } from "node:path";
import { MANIFEST_SHARD_MAX_BYTES } from "../src/shards.js"; import { manifestFiles } from "./manifest-files.js";
const root = join(import.meta.dirname, "../../..");
const big = manifestFiles(root).map((f) => [relative(root, f), statSync(f).size] as const).filter(([, n]) => n > MANIFEST_SHARD_MAX_BYTES);
for (const [f, n] of big) console.error(`${f}: ${(n / 1048576).toFixed(2)} MiB > 20 MiB (run pnpm art:shard-manifest ${f})`);
console.log(`manifest size check: ${big.length} over 20 MiB`); process.exit(big.length ? 1 : 0);
