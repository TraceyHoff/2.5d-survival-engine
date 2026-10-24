/**
 * ADR-110 follow-up: data-driven art fallbacks (data/sprite_fallbacks.json). A key the art pack has is always drawn as
 * itself (real art takes over automatically); otherwise it resolves through `to` candidates (recursively), composing
 * tint (multiply) and scale. Stage keys (crop_<plant>_<n>, sapling_<key>_<n>) derive from the plant sprite scaled by
 * stage. Pure: `has` says which sprite / icon keys exist.
 */
import raw from "../data/sprite_fallbacks.json";
import { FARMING } from "./farming.js";

interface Entry { to: string[]; tint?: string; scale?: number }
interface FallbackData { sprites: Record<string, Entry>; stages: { crop: { scale: number[] }; sapling: { tree: string[][]; pineTree: string[][]; scale: number[]; bushScale: number[] } }; icons: Record<string, string>; categoryIcons: Record<string, string> }
export const SPRITE_FALLBACKS = raw as unknown as FallbackData;
export interface ResolvedSprite { key: string; /** RGBA8 0xRRGGBBAA multiply, 0 = none */ tint: number; scale: number }

const hex = (s: string | undefined): number => (s ? ((parseInt(s.slice(1, 7), 16) << 8) | 0xff) >>> 0 : 0);
/** Multiply two packed tints (0 = identity). */
export function mulTint(a: number, b: number): number {
  if (!a) return b; if (!b) return a;
  const c = (t: number, sh: number) => (t >>> sh) & 255;
  return (((Math.round((c(a, 24) * c(b, 24)) / 255) << 24) | (Math.round((c(a, 16) * c(b, 16)) / 255) << 16) | (Math.round((c(a, 8) * c(b, 8)) / 255) << 8) | 0xff) >>> 0);
}
function stageEntry(key: string): Entry | undefined {
  const m = /^(crop|sapling)_(.+)_(\d+)$/.exec(key); if (!m) return undefined;
  const [, kind, name, n] = m as unknown as [string, string, string, string]; const i = Number(n); const st = SPRITE_FALLBACKS.stages;
  if (kind === "crop") { const sc = st.crop.scale; return { to: [`crop_${name}`, `wild_${name}`], scale: sc[Math.min(i, sc.length - 1)]! }; }
  const p = FARMING.plantables.find((x) => x.key === name);
  if (p?.type === "bush") return { to: [name], scale: st.sapling.bushScale[Math.min(i, st.sapling.bushScale.length - 1)]! };
  const rows = name === "pine_tree" ? st.sapling.pineTree : st.sapling.tree;
  return { to: [...rows[Math.min(i, rows.length - 1)]!, name], scale: st.sapling.scale[Math.min(i, st.sapling.scale.length - 1)]! };
}
/** Resolve `key` against existing sprites; undefined = nothing to draw (skip). */
export function resolveSprite(key: string, has: (k: string) => boolean, depth = 0): ResolvedSprite | undefined {
  if (has(key)) return { key, tint: 0, scale: 1 };
  if (depth > 6) return undefined;
  const e = SPRITE_FALLBACKS.sprites[key] ?? stageEntry(key); if (!e) return undefined;
  for (const c of e.to) {
    const r = resolveSprite(c, has, depth + 1);
    if (r) return { key: r.key, tint: mulTint(hex(e.tint), r.tint), scale: r.scale * (e.scale ?? 1) };
  }
  return undefined;
}
/** Item icon key: the item's own icon when present, else the mapped fallback, else the category's generic icon. */
export function resolveIcon(itemKey: string, category: string, has: (k: string) => boolean): string {
  if (has(itemKey)) return itemKey;
  const f = SPRITE_FALLBACKS.icons[itemKey]; if (f && has(f)) return f;
  const c = SPRITE_FALLBACKS.categoryIcons[category] ?? SPRITE_FALLBACKS.categoryIcons["default"]!;
  return has(c) ? c : itemKey;
}
const CATEGORY_NAMES = ["resource", "food", "tool", "placeable", "weapon", "clothing", "armor", "ammo", "explosive"];
/** Icon key for an item def (category enum index -> name for the generic icon). */
export const iconForItem = (it: { key: string; spriteKey: string; category: number }, has: (k: string) => boolean): string =>
  has(it.spriteKey) ? it.spriteKey : resolveIcon(it.key, CATEGORY_NAMES[it.category] ?? "default", has);
