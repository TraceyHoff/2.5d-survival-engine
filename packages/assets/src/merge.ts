import type { ManifestJson } from "./manifest.js";

/**
 * mergeManifests (ADR-081): typed replacement for render's mergeManifestFragments stub and Art's validate_fragment.ts
 * collision scan. Fragments merge in order; on a key collision the FIRST definition wins and the collision is reported.
 * Keyed sections: every array of {key} objects (atlases, sprites, sounds, vfx, tintSets, palettes, variantSets,
 * clanPalettes, wearables, skinTones, hairColors, clothingColors, decals and any future/unknown keyed array) plus the
 * record sections glyphs and bodyTypes (by property name). version must match; the first `name` is kept.
 * opts.resolve(path, fragment) rewrites atlas image/page/mask paths (e.g. to an art base URL); strict throws on collisions.
 * Note: clanPalettes order is significant (BuildPiece.tint = index + 1), so merging appends in fragment order.
 */
export interface ManifestFragment { name: string; manifest: ManifestJson }
export interface ManifestCollision { section: string; key: string; fragments: string[] }
export interface MergeManifestsOpts { strict?: boolean; resolve?: (path: string, fragment: string) => string }
export interface MergeManifestsResult { manifest: ManifestJson; collisions: ManifestCollision[]; warnings: string[] }
export const MANIFEST_RECORD_SECTIONS = ["glyphs", "bodyTypes"] as const;
export class ManifestMergeError extends Error {
  constructor(readonly collisions: ManifestCollision[]) { super(`manifest collisions:\n${collisions.map((c) => `${c.section}.${c.key}: ${c.fragments.join(", ")}`).join("\n")}`); }
}
type Obj = Record<string, unknown>;
const isKeyedArray = (v: unknown): v is { key: string }[] => Array.isArray(v) && v.every((x) => !!x && typeof x === "object" && typeof (x as Obj).key === "string");

export function mergeManifests(fragments: ManifestFragment[], opts: MergeManifestsOpts = {}): MergeManifestsResult {
  const out: Obj = { version: fragments[0]?.manifest.version ?? 1, atlases: [], sprites: [] }; const warnings: string[] = [];
  const owner = new Map<string, string>(); const coll = new Map<string, ManifestCollision>();
  const hit = (section: string, key: string, frag: string): boolean => {
    const id = `${section}\u0000${key}`; const first = owner.get(id); if (first === undefined) { owner.set(id, frag); return false; }
    let c = coll.get(id); if (!c) { c = { section, key, fragments: [first] }; coll.set(id, c); } c.fragments.push(frag); return true;
  };
  for (const { name, manifest } of fragments) {
    const m = manifest as unknown as Obj;
    if (m.version !== out.version) warnings.push(`${name}: version ${String(m.version)} != ${String(out.version)}`);
    if (out.name === undefined && typeof m.name === "string") out.name = m.name;
    const abs = (p: string) => (opts.resolve ? opts.resolve(p, name) : p);
    for (const [section, val] of Object.entries(m)) {
      if (section === "version" || section === "name") continue;
      if ((MANIFEST_RECORD_SECTIONS as readonly string[]).includes(section)) {
        if (!val || typeof val !== "object" || Array.isArray(val)) { warnings.push(`${name}: ${section} must be an object`); continue; }
        const dst = (out[section] ??= {}) as Obj; for (const [k, v] of Object.entries(val as Obj)) if (!hit(section, k, name)) dst[k] = v;
        continue;
      }
      if (isKeyedArray(val)) {
        const dst = (out[section] ??= []) as unknown[];
        for (const item of val) {
          if (hit(section, item.key, name)) continue;
          let v: unknown = item;
          if (section === "atlases" && opts.resolve) {
            const a = { ...(item as Obj) }; if (typeof a.image === "string") a.image = abs(a.image);
            if (Array.isArray(a.pages)) a.pages = (a.pages as { scale: number; image: string }[]).map((p) => ({ ...p, image: abs(p.image) }));
            if (a.masks && typeof a.masks === "object") a.masks = Object.fromEntries(Object.entries(a.masks as Obj).map(([k, u]) => [k, typeof u === "string" ? abs(u) : u]));
            v = a;
          }
          dst.push(v);
        }
        continue;
      }
      if (out[section] === undefined) out[section] = val; else warnings.push(`${name}: section ${section} not mergeable (kept first)`);
    }
  }
  const collisions = [...coll.values()];
  if (opts.strict && collisions.length) throw new ManifestMergeError(collisions);
  for (const c of collisions) warnings.push(`${c.section} ${c.key} defined in ${c.fragments.join(", ")} (kept ${c.fragments[0]})`);
  return { manifest: out as unknown as ManifestJson, collisions, warnings };
}
