// ADR-138: split a manifest (default: pack/customization/manifest.customization.json) into per-category shards + a small v2 index.
// Accepts a v1 monolithic file or an existing v2 index (re-shards). Categories: one per wearable slot (sprites/atlases referenced
// by that slot's wearables) plus "base" (bodies, palettes, bodyTypes, anything shared or unreferenced). A shard over
// MANIFEST_SHARD_MAX_BYTES is split by wearables into numbered parts (manifest.customization.hat.1.json, .2, ...).
// Usage: pnpm art:shard-manifest [path/to/manifest.<name>.json]
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { readManifestJson } from "../src/node.js";
import { MANIFEST_SHARD_MAX_BYTES, mergeShards, type ManifestShardRef } from "../src/shards.js";

type Obj = Record<string, any>;
const path = resolve(process.argv[2] ?? join(import.meta.dirname, "../pack/customization/manifest.customization.json"));
const dir = dirname(path); const stem = basename(path).replace(/\.json$/, "");
const m = readManifestJson(path) as unknown as Obj;
const ser = (o: unknown): string => JSON.stringify(o, null, 1) + "\n";

const wearables: Obj[] = m.wearables ?? []; const sprites: Obj[] = m.sprites ?? []; const atlases: Obj[] = m.atlases ?? [];
const spriteRefs = (o: unknown, acc: Set<string>): Set<string> => {
  if (Array.isArray(o)) for (const x of o) spriteRefs(x, acc);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "sprite" && typeof v === "string") acc.add(v); else spriteRefs(v, acc); }
  return acc;
};
const slotOf = (w: Obj): string => String(w.slot ?? "misc").replace(/[^\w-]/g, "_");
// owner of each sprite/atlas: a single slot, or "base" when shared/unreferenced
const owner = (votes: Map<string, Set<string>>, k: string): string => { const s = votes.get(k); return s && s.size === 1 ? [...s][0]! : "base"; };
const spriteVotes = new Map<string, Set<string>>();
for (const w of wearables) for (const k of spriteRefs(w, new Set())) { let s = spriteVotes.get(k); if (!s) spriteVotes.set(k, (s = new Set())); s.add(slotOf(w)); }
const spriteCat = new Map(sprites.map((s) => [s.key as string, owner(spriteVotes, s.key)]));
const atlasVotes = new Map<string, Set<string>>();
for (const s of sprites) { let v = atlasVotes.get(s.atlas); if (!v) atlasVotes.set(s.atlas, (v = new Set())); v.add(spriteCat.get(s.key)!); }
const atlasCat = new Map(atlases.map((a) => [a.key as string, owner(atlasVotes, a.key)]));

const header = { version: m.version ?? 1, ...(m.name !== undefined ? { name: m.name } : {}) };
const base: Obj = { ...header };
for (const [k, v] of Object.entries(m)) if (!["version", "name", "atlases", "sprites", "wearables"].includes(k)) base[k] = v;
base.atlases = atlases.filter((a) => atlasCat.get(a.key) === "base");
base.sprites = sprites.filter((s) => spriteCat.get(s.key) === "base");
const shard = (ws: Obj[], cat: string): Obj => {
  const sk = new Set<string>(); for (const w of ws) for (const k of spriteRefs(w, new Set())) if (spriteCat.get(k) === cat) sk.add(k);
  const ss = sprites.filter((s) => sk.has(s.key)); const ak = new Set(ss.map((s) => s.atlas));
  return { ...header, atlases: atlases.filter((a) => atlasCat.get(a.key) === cat && ak.has(a.key)), sprites: ss, wearables: ws };
};
const cats = [...new Set(wearables.map(slotOf))];
const out: { category: string; file: string; body: string }[] = [];
const baseBody = ser(base); if (Buffer.byteLength(baseBody) > MANIFEST_SHARD_MAX_BYTES) throw new Error(`base shard over limit (${Buffer.byteLength(baseBody)} B)`);
out.push({ category: "base", file: `${stem}.base.json`, body: baseBody });
for (const cat of cats) {
  const ws = wearables.filter((w) => slotOf(w) === cat); const whole = ser(shard(ws, cat));
  if (Buffer.byteLength(whole) <= MANIFEST_SHARD_MAX_BYTES) { out.push({ category: cat, file: `${stem}.${cat}.json`, body: whole }); continue; }
  // numbered parts: greedy by wearable, each part under the limit
  const parts: Obj[][] = [[]];
  for (const w of ws) {
    const cur = parts[parts.length - 1]!; const trial = ser(shard([...cur, w], cat));
    if (cur.length && Buffer.byteLength(trial) > MANIFEST_SHARD_MAX_BYTES) parts.push([w]); else cur.push(w);
  }
  parts.forEach((p, i) => {
    const body = ser(shard(p, cat)); if (Buffer.byteLength(body) > MANIFEST_SHARD_MAX_BYTES) throw new Error(`${cat}: single wearable ${p[0]!.key} exceeds the shard limit`);
    out.push({ category: cat, file: `${stem}.${cat}.${i + 1}.json`, body });
  });
}
// round-trip check: every entry lands in exactly one shard
const merged = mergeShards(out.map((o) => ({ file: o.file, manifest: JSON.parse(o.body) }))) as unknown as Obj;
for (const sec of ["atlases", "sprites", "wearables"]) if ((merged[sec] ?? []).length !== (m[sec] ?? []).length) throw new Error(`${sec}: ${merged[sec]?.length} after sharding vs ${m[sec]?.length}`);
const keep = new Set(out.map((o) => o.file));
for (const f of readdirSync(dir)) if (f.startsWith(stem + ".") && f.endsWith(".json") && !keep.has(f)) unlinkSync(join(dir, f));
const shards: ManifestShardRef[] = out.map((o) => {
  writeFileSync(join(dir, o.file), o.body);
  return { category: o.category, file: o.file, bytes: Buffer.byteLength(o.body), sha: createHash("sha256").update(o.body).digest("hex") };
});
writeFileSync(path, JSON.stringify({ version: 2, ...(m.name !== undefined ? { name: m.name } : {}), shards }, null, 1) + "\n");
for (const s of shards) console.log(`${s.file.padEnd(44)} ${(s.bytes / 1048576).toFixed(2).padStart(6)} MiB`);
console.log(`index ${basename(path)} ${readFileSync(path).length} B, ${shards.length} shards`);
