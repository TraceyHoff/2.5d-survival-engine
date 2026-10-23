// Validates manifest.fragment.json with the real engine loader: alone, and merged (+ main_pack.patch.json) into
// both main manifests. Fails on any ManifestError (incl. key collisions) and prints loader warnings.
import { readFileSync, existsSync } from "node:fs";
import { loadManifest } from "/workspace/engine/packages/assets/src/manifest.ts";
const J = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const R = "/workspace/assets/survival_fx/";
const frag = J(R + "manifest.fragment.json"); const patch = J(R + "main_pack.patch.json");
const show = (label: string, r: ReturnType<typeof loadManifest>) =>
  console.log(`${label}: OK, ${r.registry.size} sprites, ${r.registry.vfx.size} vfx, warnings: ${r.warnings.length ? r.warnings.join(" | ") : "none"}`);
show("fragment alone", loadManifest(frag));
function applyPatch(m: any) {
  for (const a of patch.atlases) { const t = m.atlases.find((x: any) => x.key === a.key); if (t) t.masks = { ...(t.masks ?? {}), ...a.masks }; }
  for (const s of patch.sprites) { const t = m.sprites.find((x: any) => x.key === s.key); if (!t) continue; if (s.sway) t.sway = s.sway; if (s.tints) t.tints = { ...(t.tints ?? {}), ...s.tints }; }
  return m;
}
for (const p of ["/workspace/assets/manifest.json", "/workspace/engine/packages/assets/pack/manifest.json"]) {
  if (!existsSync(p)) continue;
  const main = applyPatch(J(p));
  for (const k of ["atlases", "sprites", "vfx"] as const) {
    const have = new Set((main[k] ?? []).map((x: any) => x.key)); const clash = (frag[k] ?? []).filter((x: any) => have.has(x.key)).map((x: any) => x.key);
    if (clash.length) { console.error(`${p}: ${k} key collisions: ${clash.join(", ")}`); process.exit(1); }
  }
  const merged = { ...main, atlases: [...main.atlases, ...frag.atlases], sprites: [...main.sprites, ...frag.sprites], vfx: [...(main.vfx ?? []), ...frag.vfx] };
  show(`merged + patch into ${p}`, loadManifest(merged));
}
