import { readFileSync, existsSync } from "node:fs";
import { loadManifest, validateBuildingSprites } from "/workspace/engine/packages/assets/src/manifest.ts";
const frag = JSON.parse(readFileSync("/workspace/assets/stalls/manifest.fragment.json", "utf8"));
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
const prop = JSON.parse(readFileSync("/workspace/assets/stalls/pieces.proposed.json", "utf8")).pieces;
const used = [...new Set(frag.sprites.filter((s: any) => s.building).map((s: any) => s.building.piece))];
console.log("pieces reused from pieces.json:", used.filter((k) => by.has(k)), " new (proposed):", used.filter((k) => !by.has(k)));
for (const p of prop) if (!by.has(p.key)) by.set(p.key, p);
const lookup = { byKey(key: string) { const p: any = by.get(key); if (!p) return undefined as any; const pl = p.placement; return { footprint: p.footprint ?? { w: 1, h: 1 }, layer: p.layer ?? (pl === "edge" || pl === "opening" ? 1 : 2) }; } };
try { console.log("validateBuildingSprites:", validateBuildingSprites(r.registry, lookup)); } catch (e) { console.log("validateBuildingSprites threw:", String(e)); }
for (const a of frag.atlases) if (a.masks?.sway && !existsSync("/workspace/assets/" + a.masks.sway)) console.log("missing sway", a.masks.sway);
for (const p of ["/workspace/assets/manifest.json", "/workspace/assets/pvp_clan/manifest.fragment.json", "/workspace/assets/survival_fx/manifest.fragment.json", "/workspace/assets/ui/atlas/engine/manifest.ui.json"]) {
  if (!existsSync(p)) continue; const o = JSON.parse(readFileSync(p, "utf8"));
  for (const k of kinds) { const a = new Set((o[k] ?? []).map((x: any) => x.key)); const c = (frag[k] ?? []).filter((x: any) => a.has(x.key)).map((x: any) => x.key); console.log("collide", p.split("/assets/")[1], k, c.length ? c : "none"); }
}
const sd: any = [...(r.registry as any).sprites.values()].find((s: any) => s.key === "stall_cart_pine_red");
console.log("attach kept by loader:", !!sd?.attach, " states:", JSON.stringify(sd?.building?.states ? Object.keys(sd.building.states) : sd?.building));
