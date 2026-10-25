import { readFileSync } from "node:fs";
import type { ManifestJson } from "./manifest.js";
import { isShardIndex, mergeShards } from "./shards.js";

// Kept free of import.meta so jsdom-environment tests can import it ("@engine/assets/read-manifest").
/** Read a manifest file from disk: v1 monolithic as-is, v2 shard index (ADR-138) merged from its shards beside it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readManifestJson<T = any>(path: string): T {
  const json = JSON.parse(readFileSync(path, "utf8")) as unknown; if (!isShardIndex(json)) return json as T;
  const dir = path.replace(/[^/]*$/, "");
  return mergeShards(json.shards.map((s) => ({ file: s.file, manifest: JSON.parse(readFileSync(dir + s.file, "utf8")) as ManifestJson }))) as T;
}
