/**
 * Content loading for the demo:
 *  1. /@art/manifest.json (Art & Assets' real content in /workspace/assets, read-only) when it exists;
 *  2. otherwise the @engine/assets SAMPLE manifest (debug placeholders) + a TexturePacker JSON-hash fixture
 *     (assets/debug/zombies_tp.json) merged through importTexturePacker -> mergeTexturePacker -> loadManifest.
 */
import { loadManifest, type AssetRegistry, type ManifestJson } from "@engine/assets";
import { importTexturePacker, mergeTexturePacker, sourcesFromManifest, swayFromManifest, type AtlasSource, type SwayParams, type TPJsonHash } from "../src/index.js";

export interface Content { registry: AssetRegistry; sources: Map<string, AtlasSource>; origin: "art" | "sample"; issues: string[]; sway: Record<string, SwayParams> }

async function json<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); if (!r.ok) return null; const ct = r.headers.get("content-type") ?? ""; if (!ct.includes("json")) return null; return (await r.json()) as T; } catch { return null; }
}

export async function loadContent(opts: { preferArt: boolean }): Promise<Content> {
  if (opts.preferArt) {
    const art = await json<ManifestJson>("/@art/manifest.json");
    if (art) {
      const lock = await json<Record<string, Record<string, number>>>("/@art/ids.lock.json");
      // survival_fx manifest fragments ({parts:[{atlas, sprites}]}) merged in; keys already in the base manifest win
      const issues: string[] = []; const fxAtlases = new Set<string>();
      const merged = { ...art, atlases: [...art.atlases], sprites: [...art.sprites] };
      for (const f of ["heat", "status", "wind"]) {
        const frag = await json<{ parts: { atlas: ManifestJson["atlases"][number]; sprites: ManifestJson["sprites"] }[] }>(`/@art/survival_fx/build/${f}.json`);
        for (const part of frag?.parts ?? []) {
          if (merged.atlases.some((a) => a.key === part.atlas.key)) { issues.push(`fx atlas ${part.atlas.key} duplicates base`); continue; }
          merged.atlases.push(part.atlas); fxAtlases.add(part.atlas.key);
          for (const sp of part.sprites) { if (merged.sprites.some((x) => x.key === sp.key)) { issues.push(`fx sprite ${sp.key} duplicates base (kept base)`); continue; } merged.sprites.push(sp); }
        }
      }
      const { registry } = loadManifest(merged, lock ? { lock } : {});
      const sw = swayFromManifest(merged);
      const sources = sourcesFromManifest(registry, "/@art/manifest.json");
      for (const k of fxAtlases) { const a = registry.atlases.get(k)!; sources.set(k, { url: `/@art/survival_fx/atlases/${a.image}`, emissiveUrl: a.emissiveImage ? `/@art/survival_fx/atlases/${a.emissiveImage}` : null }); }
      return { registry, sources, origin: "art", issues: [...issues, ...sw.issues], sway: sw.table };
    }
  }
  const base = await json<ManifestJson>("/@sample/manifest.json");
  if (!base) throw new Error("sample manifest not found (/@sample/manifest.json)");
  const lock = await json<Record<string, Record<string, number>>>("/@sample/ids.lock.json");
  const tp = await json<TPJsonHash>("/debug/zombies_tp.json");
  const imports = tp ? [importTexturePacker(tp, { key: "zombies_tp", category: "zombie" })] : [];
  const merged = mergeTexturePacker(base, imports);
  const { registry } = loadManifest(merged.manifest, lock ? { lock } : {});
  const sources = sourcesFromManifest(registry, "/@sample/manifest.json", merged.rects);
  if (tp) sources.set("zombies_tp", { url: "/debug/zombies_tp.png", emissiveUrl: null, rects: merged.rects["zombies_tp"]! });
  const sw = swayFromManifest(merged.manifest);
  return { registry, sources, origin: "sample", issues: [...merged.issues, ...imports.flatMap((i) => i.issues), ...sw.issues], sway: sw.table };
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
