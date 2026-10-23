import { readFileSync, existsSync } from "node:fs";
import { loadManifest, validateBuildingSprites } from "/workspace/engine/packages/assets/src/manifest.ts";
const frag = JSON.parse(readFileSync("/workspace/assets/pvp_clan/manifest.fragment.json", "utf8"));
const pack = JSON.parse(readFileSync("/workspace/engine/packages/assets/pack/manifest.json", "utf8"));
const r = loadManifest(frag);
console.log("fragment OK:", r.registry.sprites.size, "sprites,", r.registry.vfx.size, "vfx; warnings:", r.warnings);
// files exist
const miss: string[] = [];
for (const a of frag.atlases) { for (const p of [a.image, ...(a.pages ?? []).map((x: any) => x.image), ...(a.masks?.tintmask ? [a.masks.tintmask] : []), ...(a.masks?.emissive ? [a.image.replace(".png", "_emissive.png")] : [])]) if (!existsSync("/workspace/assets/" + p)) miss.push(p); }
console.log("missing files:", miss);
// collisions
const kinds = ["atlases", "sprites", "vfx", "tintSets", "palettes", "sounds", "variantSets"] as const;
for (const k of kinds) { const a = new Set((pack[k] ?? []).map((x: any) => x.key)); const c = (frag[k] ?? []).filter((x: any) => a.has(x.key)).map((x: any) => x.key); console.log("collide", k, c); }
const merged: any = { ...pack }; for (const k of kinds) merged[k] = [...(pack[k] ?? []), ...(frag[k] ?? [])];
const m = loadManifest(merged); console.log("merged OK:", m.registry.sprites.size, "sprites; warnings:", m.warnings.length);
const pieces = JSON.parse(readFileSync("/workspace/engine/packages/gameplay/data/pieces.json", "utf8"));
const list: any[] = Array.isArray(pieces) ? pieces : (pieces.pieces ?? Object.values(pieces));
const by = new Map(list.map((p: any) => [p.key, p]));
const prop = JSON.parse(readFileSync("/workspace/assets/pvp_clan/pieces.proposed.json", "utf8")).pieces;
const used = [...new Set(frag.sprites.filter((s: any) => s.building).map((s: any) => s.building.piece))];
console.log("pieces reused from pieces.json:", used.filter((k) => by.has(k)), " new (proposed):", used.filter((k) => !by.has(k)));
for (const p of prop) if (!by.has(p.key)) by.set(p.key, p);
const lookup = { byKey(key: string) { const p: any = by.get(key); if (!p) return undefined as any; const pl = p.placement; return { footprint: p.footprint ?? { w: 1, h: 1 }, layer: p.layer ?? (pl === "edge" || pl === "opening" ? 1 : 2) }; } };
try { console.log("validateBuildingSprites:", validateBuildingSprites(r.registry, lookup)); } catch (e) { console.log("validateBuildingSprites threw:", String(e)); }

// ---- ADR-077/078 checks: three-way merge (pack + survival_fx + pvp_clan), zero duplicate keys, files on disk ----
import { validateAssetFilesOnDisk } from "/workspace/engine/packages/assets/src/node.ts";
let fail = false;
console.log("clanPalettes:", r.registry.clanPalettes.length, "e.g.", r.registry.clanPalette(0));
const fileIssues = validateAssetFilesOnDisk(r.registry, "/workspace/assets/");
console.log("fragment validateAssetFilesOnDisk:", fileIssues.length ? fileIssues : "0 issues"); if (fileIssues.length) fail = true;
const sfx = JSON.parse(readFileSync("/workspace/assets/survival_fx/manifest.fragment.json", "utf8"));
const sfxPatch = JSON.parse(readFileSync("/workspace/assets/survival_fx/main_pack.patch.json", "utf8"));
const all3 = ["atlases", "sprites", "vfx", "tintSets", "palettes", "sounds", "variantSets", "clanPalettes"] as const;
for (const [label, mainPath, base] of [["assets", "/workspace/assets/manifest.json", "/workspace/assets/"], ["engine pack", "/workspace/engine/packages/assets/pack/manifest.json", "/workspace/engine/packages/assets/pack/"]] as const) {
  const main = JSON.parse(readFileSync(mainPath, "utf8"));
  for (const a of sfxPatch.atlases) { const t = main.atlases.find((x: any) => x.key === a.key); if (t) t.masks = { ...(t.masks ?? {}), ...a.masks }; }
  for (const s of sfxPatch.sprites) { const t = main.sprites.find((x: any) => x.key === s.key); if (!t) continue; if (s.sway) t.sway = s.sway; if (s.tints) t.tints = { ...(t.tints ?? {}), ...s.tints }; }
  const m3: any = { ...main };
  const dups: string[] = [];
  for (const k of all3) { const list = [...(main[k] ?? []), ...(sfx[k] ?? []), ...(frag[k] ?? [])]; m3[k] = list; const seen = new Set<string>();
    for (const x of list) { if (seen.has(x.key)) dups.push(`${k}:${x.key}`); seen.add(x.key); } }
  console.log(`[${label}] duplicate keys (pack+survival_fx+pvp_clan):`, dups.length ? dups : "0"); if (dups.length) fail = true;
  try {
    const mr = loadManifest(m3); console.log(`[${label}] merged3 OK: ${mr.registry.sprites.size} sprites, ${mr.registry.vfx.size} vfx, ${mr.registry.clanPalettes.length} clanPalettes; warnings: ${mr.warnings.length}`);
    // main-pack paths resolve against the pack dir; fragment paths (survival_fx/..., pvp_clan/...) against /workspace/assets
    const iss = validateAssetFilesOnDisk(mr.registry, base).filter((x) => !/(survival_fx|pvp_clan)\//.test(x) || base === "/workspace/assets/");
    console.log(`[${label}] merged3 validateAssetFilesOnDisk(${base}):`, iss.length ? iss : "0 issues"); if (iss.length) fail = true;
  } catch (e: any) { console.log(`[${label}] merged3 FAILED:`, e.issues ?? String(e)); fail = true; }
}
if (fail) process.exit(1);
