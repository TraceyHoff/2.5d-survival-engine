/**
 * ADAPTER (render-side stub for a missing @engine/assets feature): merge Art & Assets manifest fragments
 * (e.g. assets/stalls/manifest.fragment.json, assets/pvp_clan/manifest.fragment.json) into a base manifest before
 * loadManifest. Fragment image/page/mask paths are relative to the art root (`stalls/atlases/...`) and are rewritten to
 * absolute URLs under `artBase` so sourcesFromManifest keeps them. Keys already present win (first definition kept).
 * Requested in @engine/assets: a typed `mergeManifests(base, fragments, { resolve })` with collision reporting.
 */
import type { ManifestJson } from "@engine/assets";

const KEYED = ["atlases", "sprites", "vfx", "tintSets", "palettes", "sounds", "variantSets", "clanPalettes"] as const;

export function mergeManifestFragments(base: ManifestJson, fragments: { json: ManifestJson; artBase: string }[]): { manifest: ManifestJson; issues: string[] } {
  const issues: string[] = []; const out = { ...base } as unknown as Record<string, unknown[]>;
  for (const k of KEYED) out[k] = [...(((base as unknown as Record<string, unknown[]>)[k]) ?? [])];
  for (const { json, artBase } of fragments) {
    const abs = (p: string): string => (/^(\/|[a-z]+:)/i.test(p) ? p : artBase.replace(/\/?$/, "/") + p);
    for (const k of KEYED) {
      const list = ((json as unknown as Record<string, unknown[]>)[k]) ?? []; const have = new Set(out[k]!.map((x) => (x as { key: string }).key));
      for (const item of list) {
        const key = (item as { key: string }).key;
        if (have.has(key)) { issues.push(`${json.name ?? "fragment"}: ${k} ${key} already defined (kept first)`); continue; }
        let v = item;
        if (k === "atlases") {
          const a = { ...(item as ManifestJson["atlases"][number]) } as Record<string, unknown> & { image: string };
          a.image = abs(a.image);
          if (Array.isArray(a.pages)) a.pages = (a.pages as { scale: number; image: string }[]).map((p) => ({ ...p, image: abs(p.image) }));
          if (a.masks && typeof a.masks === "object") a.masks = Object.fromEntries(Object.entries(a.masks as Record<string, unknown>).map(([m, u]) => [m, typeof u === "string" ? abs(u) : u]));
          if (typeof a.emissive === "string") a.emissive = abs(a.emissive);
          v = a;
        }
        out[k]!.push(v); have.add(key);
      }
    }
  }
  return { manifest: out as unknown as ManifestJson, issues };
}
