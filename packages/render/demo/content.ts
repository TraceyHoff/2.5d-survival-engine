/**
 * Content loading for the demo / screenshots:
 *  1. default: Art & Assets' pack via @engine/assets fetchDefaultManifest("/@assets/") (packages/assets/pack/).
 *     Optional survival_fx manifest fragments from /@art/survival_fx/build/*.json (read-only /workspace/assets) are
 *     merged into the pack manifest on the way in (keys already in the pack win).
 *  2. ?content=sample: the @engine/assets SAMPLE fixture + a TexturePacker JSON-hash fixture (assets/debug/zombies_tp.json)
 *     merged through importTexturePacker -> mergeTexturePacker -> loadManifest (debug only).
 */
import { DEFAULT_MANIFEST, fetchDefaultManifest, loadManifest, type AssetRegistry, type ManifestJson } from "@engine/assets";
import { importTexturePacker, mergeTexturePacker, sourcesFromManifest, swayFromManifest, type AtlasSource, type SwayParams, type TPJsonHash } from "../src/index.js";

export interface Content { registry: AssetRegistry; sources: Map<string, AtlasSource>; origin: "pack" | "sample"; issues: string[]; sway: Record<string, SwayParams> }

async function json<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); if (!r.ok) return null; const ct = r.headers.get("content-type") ?? ""; if (!ct.includes("json")) return null; return (await r.json()) as T; } catch { return null; }
}

export const ASSETS_BASE = "/@assets/";
const FX_FRAGMENTS = ["heat", "status", "wind"];

export async function loadContent(opts: { content: "pack" | "sample" }): Promise<Content> {
  if (opts.content === "pack") {
    const manifestUrl = ASSETS_BASE + DEFAULT_MANIFEST;
    const issues: string[] = []; const fxAtlases = new Set<string>(); let merged: ManifestJson | null = null;
    // fetcher hook: merge optional survival_fx fragments into the pack manifest before loadManifest
    const fetcher = async (u: string): Promise<{ ok: boolean; json(): Promise<unknown> }> => {
      const r = await fetch(u);
      if (u !== manifestUrl || !r.ok) return r;
      const pack = (await r.json()) as ManifestJson;
      const m: ManifestJson = { ...pack, atlases: [...pack.atlases], sprites: [...pack.sprites] };
      for (const f of FX_FRAGMENTS) {
        const frag = await json<{ parts: { atlas: ManifestJson["atlases"][number]; sprites: ManifestJson["sprites"] }[] }>(`/@art/survival_fx/build/${f}.json`);
        for (const part of frag?.parts ?? []) {
          if (m.atlases.some((a) => a.key === part.atlas.key)) { issues.push(`fx atlas ${part.atlas.key} duplicates pack`); continue; }
          m.atlases.push(part.atlas); fxAtlases.add(part.atlas.key);
          for (const sp of part.sprites) { if (m.sprites.some((x) => x.key === sp.key)) { issues.push(`fx sprite ${sp.key} duplicates pack (kept pack)`); continue; } m.sprites.push(sp); }
        }
      }
      merged = m;
      return { ok: true, json: async () => m };
    };
    const { registry } = await fetchDefaultManifest(ASSETS_BASE, fetcher);
    const sources = sourcesFromManifest(registry, manifestUrl);
    for (const k of fxAtlases) { const a = registry.atlases.get(k)!; sources.set(k, { url: `/@art/survival_fx/atlases/${a.image}`, emissiveUrl: a.emissiveImage ? `/@art/survival_fx/atlases/${a.emissiveImage}` : null }); }
    // sway: SpriteDef.sway is read by AtlasManager directly; fragments may still carry legacy sway blocks
    const sw = merged ? swayFromManifest(merged) : { table: {}, issues: [] as string[] };
    return { registry, sources, origin: "pack", issues: [...issues, ...sw.issues], sway: sw.table };
  }
  const base = await json<ManifestJson>("/@assets/sample/manifest.json");
  if (!base) throw new Error("sample fixture not found (/@assets/sample/manifest.json)");
  const lock = await json<Record<string, Record<string, number>>>("/@assets/sample/ids.lock.json");
  const tp = await json<TPJsonHash>("/debug/zombies_tp.json");
  const imports = tp ? [importTexturePacker(tp, { key: "zombies_tp", category: "zombie" })] : [];
  const mergedS = mergeTexturePacker(base, imports);
  const { registry } = loadManifest(mergedS.manifest, lock ? { lock } : {});
  const sources = sourcesFromManifest(registry, "/@assets/sample/manifest.json", mergedS.rects);
  if (tp) sources.set("zombies_tp", { url: "/debug/zombies_tp.png", emissiveUrl: null, rects: mergedS.rects["zombies_tp"]! });
  const sw = swayFromManifest(mergedS.manifest);
  return { registry, sources, origin: "sample", issues: [...mergedS.issues, ...imports.flatMap((i) => i.issues), ...sw.issues], sway: sw.table };
}

/** DEBUG theme: hue-shifted copies of some atlases, generated at runtime (exercises registerTheme/setTheme only). */
export async function makeDebugTheme(sources: Map<string, AtlasSource>, keys: string[], hueDeg: number): Promise<Record<string, AtlasSource>> {
  const out: Record<string, AtlasSource> = {};
  for (const k of keys) {
    const src = sources.get(k); if (!src) continue;
    const bmp = await createImageBitmap(await (await fetch(src.url)).blob());
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d")!; g.filter = `hue-rotate(${hueDeg}deg) saturate(1.4)`; g.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
    out[k] = { ...src, url: URL.createObjectURL(blob) };
  }
  return out;
}
