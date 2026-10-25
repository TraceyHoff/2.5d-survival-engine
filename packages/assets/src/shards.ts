import type { ManifestJson } from "./manifest.js";

/**
 * ADR-138 sharded manifests. A manifest file is either a v1 monolithic manifest (ManifestJson) or a v2 index:
 *   {"version":2,"name":"customization","shards":[{"category":"hat","file":"manifest.customization.hat.json","bytes":N,"sha":"<sha256 hex>"},...]}
 * Each shard is a v1 manifest fragment (same entry schema) holding one category; shard file paths are relative to the index.
 * mergeShards concatenates keyed arrays / unions record sections in index order. Unlike mergeManifests (first wins),
 * a key defined in two shards is an error (ShardMergeError). Scalars (version, name, tintNeutral...) must agree.
 */
export const MANIFEST_SHARD_MAX_BYTES = 20 * 1024 * 1024;
export interface ManifestShardRef { category: string; file: string; bytes: number; sha: string }
export interface ManifestShardIndex { version: 2; name?: string; shards: ManifestShardRef[] }
export class ShardMergeError extends Error {}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export const isShardIndex = (j: unknown): j is ManifestShardIndex => isObj(j) && j.version === 2 && Array.isArray(j.shards);

export function mergeShards(shards: { file: string; manifest: ManifestJson }[]): ManifestJson {
  const out: Obj = {}; const owner = new Map<string, string>();
  const claim = (id: string, file: string): void => {
    const prev = owner.get(id); if (prev !== undefined) throw new ShardMergeError(`manifest shards: duplicate ${id} in ${prev} and ${file}`); owner.set(id, file);
  };
  for (const { file, manifest } of shards) {
    for (const [sec, v] of Object.entries(manifest as unknown as Obj)) {
      const cur = out[sec];
      if (Array.isArray(v)) {
        const keyed = v.every((x) => isObj(x) && typeof x.key === "string");
        if (keyed) { for (const x of v as Obj[]) claim(`${sec}.${String(x.key)}`, file); out[sec] = [...((cur as unknown[]) ?? []), ...v]; }
        else { claim(sec, file); out[sec] = v; }
      } else if (isObj(v)) {
        if (cur !== undefined && !isObj(cur)) throw new ShardMergeError(`manifest shards: section ${sec} type differs in ${file}`);
        for (const k of Object.keys(v)) claim(`${sec}.${k}`, file);
        out[sec] = { ...((cur as Obj) ?? {}), ...v };
      } else if (cur === undefined) out[sec] = v;
      else if (cur !== v) throw new ShardMergeError(`manifest shards: ${sec} differs (${JSON.stringify(cur)} vs ${JSON.stringify(v)} in ${file})`);
    }
  }
  return out as unknown as ManifestJson;
}

/** Resolve a manifest JSON (v1 passes through; v2 fetches every shard in parallel via `load(file)` and merges). */
export async function resolveManifestShards(json: unknown, load: (file: string, ref: ManifestShardRef) => Promise<unknown>): Promise<ManifestJson> {
  if (!isShardIndex(json)) return json as ManifestJson;
  const parts = await Promise.all(json.shards.map(async (s) => {
    const m = await load(s.file, s); if (m === undefined || m === null) throw new Error(`manifest shard missing: ${s.file}`);
    return { file: s.file, manifest: m as ManifestJson };
  }));
  return mergeShards(parts);
}
