/**
 * ADR-110 decorative ground clutter: render-only (never an ECS entity on the server, never networked / persisted),
 * deterministic from (seed, tile) so every peer sees the same pebbles, and biome-driven. Clients scale `density`
 * by quality (lowend ~0.35). Missing art = nothing drawn.
 */
export interface ClutterItem { key: string; x: number; y: number; scale: number; flip: boolean }
/** Biome tile id -> weighted clutter keys + per-tile chance at density 1 (tile ids as worldgen: 2 sand, 3 grass, 4 forest, 5 stone). */
export const CLUTTER_TABLES: Record<number, { chance: number; keys: readonly (readonly [string, number])[] }> = {
  2: { chance: 0.06, keys: [["clutter_pebbles", 3], ["clutter_shell", 1], ["clutter_reeds", 2], ["clutter_driftwood", 1]] },
  3: { chance: 0.16, keys: [["clutter_grass_tuft_a", 5], ["clutter_grass_tuft_b", 4], ["clutter_flower_a", 2], ["clutter_flower_b", 2], ["clutter_flower_c", 1], ["clutter_pebbles", 1], ["clutter_twigs", 1]] },
  4: { chance: 0.2, keys: [["clutter_leaves", 4], ["clutter_twigs", 3], ["clutter_fern", 3], ["clutter_mushroom", 1], ["clutter_grass_tuft_b", 2], ["clutter_moss_rock", 1]] },
  5: { chance: 0.08, keys: [["clutter_pebbles", 3], ["clutter_rock_small", 2], ["clutter_dry_grass", 1]] },
};
export const CLUTTER_KEYS: readonly string[] = [...new Set(Object.values(CLUTTER_TABLES).flatMap((t) => t.keys.map(([k]) => k)))].sort();

function hash(seed: number, x: number, y: number, salt: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Clutter for one chunk (tiles [cx*size, (cx+1)*size)). Pure + deterministic; density in [0,1]. */
export function clutterForChunk(seed: number, cx: number, cy: number, size: number, tileAt: (tx: number, ty: number) => number, density = 1): ClutterItem[] {
  const out: ClutterItem[] = []; if (density <= 0) return out;
  for (let ty = cy * size; ty < (cy + 1) * size; ty++) for (let tx = cx * size; tx < (cx + 1) * size; tx++) {
    const t = CLUTTER_TABLES[tileAt(tx, ty)]; if (!t || hash(seed, tx, ty, 1) >= t.chance * density) continue;
    const total = t.keys.reduce((a, [, w]) => a + w, 0); let r = hash(seed, tx, ty, 2) * total; let key = t.keys[0]![0];
    for (const [k, w] of t.keys) { if ((r -= w) < 0) { key = k; break; } }
    out.push({ key, x: tx + 0.15 + hash(seed, tx, ty, 3) * 0.7, y: ty + 0.15 + hash(seed, tx, ty, 4) * 0.7, scale: 0.8 + hash(seed, tx, ty, 5) * 0.4, flip: hash(seed, tx, ty, 6) < 0.5 });
  }
  return out;
}
