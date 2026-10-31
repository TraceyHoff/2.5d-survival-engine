/**
 * ADR-246: Art & Assets' `gt_` ground tileset (ground_tileset_spec.md): per-season base variants, blob-47 transition
 * overlays, shore/bank overlays, winter ice and fall leaf decals. Pure layer composition (mirrors Art's
 * ground_preview.py `tile_layers`) shared by the WebGL2 TileTerrain pass and the Canvas2D block cache, plus the
 * per-registry key resolver ("ground season loader": `<key>_<fall|winter>` first, winter water aliased to gt_ice).
 *
 * Cell: 68x52 px (64x48 art + 2 px pad), diamond centre at frame px (34, 18) = anchor (0.5, 18/52); @2x pages 136x104.
 */
import { TileId } from "./ids.js";

/** Land materials, lowest -> highest priority: a higher material's edge overlay is drawn onto a lower neighbour. */
export const GROUND_PRIORITY = ["rock", "sand", "dirt", "mud", "forest", "grass", "snow"] as const;
export type GroundMaterial = (typeof GROUND_PRIORITY)[number];
const PRIO: Record<string, number> = Object.fromEntries(GROUND_PRIORITY.map((m, i) => [m, i]));

/** Terrain id -> gt material ("water" for both water depths; undefined = no ground art, e.g. empty). */
export function groundMaterial(id: number): GroundMaterial | "water" | undefined {
  switch (id) {
    case TileId.Water: case TileId.ShallowWater: return "water";
    case TileId.Sand: return "sand"; case TileId.Grass: return "grass"; case TileId.Dirt: return "dirt"; case TileId.Stone: return "rock";
    case TileId.Snow: return "snow"; case TileId.Forest: return "forest"; case TileId.Mud: return "mud";
    default: return undefined;
  }
}
/** Position hash (0..996), identical to Art's preview and the legacy tile variant pick. */
export const groundHash = (x: number, y: number): number => ((Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0) % 997;
export const GROUND_VARIANTS = ["", "_b", "_c", "_d", "_e", "_f"] as const;
/** Blob-47 neighbour bits (tile axes): N(0,-1)=1 E(1,0)=2 S(0,1)=4 W(-1,0)=8 NE=16 SE=32 SW=64 NW=128. */
export const BLOB_DIRS: readonly (readonly [number, number, number])[] = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8], [1, -1, 16], [1, 1, 32], [-1, 1, 64], [-1, -1, 128]];
/** A corner bit only counts when neither adjacent edge is set (47 distinct masks incl. 0). */
export function blobReduce(m: number): number {
  if (m & 16 && m & (1 | 2)) m &= ~16; if (m & 32 && m & (4 | 2)) m &= ~32;
  if (m & 64 && m & (4 | 8)) m &= ~64; if (m & 128 && m & (1 | 8)) m &= ~128;
  return m;
}
/** Season art index (SeasonVisual.art): 0 summer, 1 fall, 2 winter -> key suffix. */
export const GROUND_SEASON_SUFFIX = ["", "_fall", "_winter"] as const;

/** Layer kinds (bottom -> top within one cell). */
export const enum GroundLayerKind { Base = 0, Edge = 1, Shore = 2, Water = 3, Ice = 4, Leaves = 5 }
export interface GroundLayer { key: string; kind: GroundLayerKind }
/** Fall leaf decals: share of water cells (by hash) carrying one, near land (tint >= 0.3) / open water. */
export const LEAF_NEAR = 0.3, LEAF_FAR = 0.08;

/**
 * Sprite keys for one cell, bottom to top (unresolved: the loader falls back per key). `tint(x, y)` = shore tint 0..1
 * (only consulted for fall leaves). Returns [] for empty cells.
 */
export function groundLayers(tileAt: (x: number, y: number) => number, x: number, y: number, season: number, tint?: (x: number, y: number) => number, out: GroundLayer[] = []): GroundLayer[] {
  out.length = 0; const id = tileAt(x, y); const mat = groundMaterial(id); if (!mat) return out;
  const h = groundHash(x, y), v = GROUND_VARIANTS[h % 6]!, suf = GROUND_SEASON_SUFFIX[season] ?? "";
  if (mat === "water") {
    if (season === 2) { out.push({ key: `gt_ice${v}`, kind: GroundLayerKind.Ice }); return out; } // winter: static, untinted ice
    out.push({ key: id === TileId.ShallowWater ? "gt_water_shallow" : "gt_water", kind: GroundLayerKind.Water });
    if (season === 1 && (h % 100) < (!tint || tint(x, y) >= 0.3 ? LEAF_NEAR : LEAF_FAR) * 100)
      out.push({ key: `gt_water_leaves_${"abc"[(h >> 3) % 3]}`, kind: GroundLayerKind.Leaves }); // after the tint (own instance)
    return out;
  }
  out.push({ key: `gt_${mat}${v}${suf}`, kind: GroundLayerKind.Base });
  // neighbour materials once
  const nm: (string | undefined)[] = BLOB_DIRS.map(([dx, dy]) => { const n = tileAt(x + dx, y + dy); return n === 0 ? undefined : groundMaterial(n); });
  const me = PRIO[mat]!;
  for (let p = me + 1; p < GROUND_PRIORITY.length; p++) {
    const inv = GROUND_PRIORITY[p]!; let m = 0; for (let d = 0; d < 8; d++) if (nm[d] === inv) m |= BLOB_DIRS[d]![2];
    m = blobReduce(m); if (m) out.push({ key: `gt_${inv}_edge_${m}${suf}`, kind: GroundLayerKind.Edge });
  }
  let w = 0; for (let d = 0; d < 8; d++) if (nm[d] === "water") w |= BLOB_DIRS[d]![2];
  w = blobReduce(w); if (w) out.push({ key: `gt_${mat === "sand" ? "shore" : "bank"}_${w}${suf}`, kind: GroundLayerKind.Shore });
  return out;
}

interface Reg { ids: { sprites: { tryId(k: string): number | undefined } }; sprite(id: number): { key: string; atlas: { key: string } } }
/**
 * Ground season loader for one registry: key -> sprite id with fallbacks (`<key>` without the season suffix; winter
 * water -> gt_water_winter = ice), the pages each season needs (one representative sprite per atlas page) and the
 * legacy placeholder per material. `available` = the registry ships the gt_ set at all.
 */
export class GroundArt {
  readonly available: boolean;
  private ids = new Map<string, number>();
  private pages: number[][] = [];
  constructor(private reg: Reg) {
    this.available = reg.ids.sprites.tryId("gt_grass") !== undefined && reg.ids.sprites.tryId("gt_water") !== undefined;
    if (!this.available) return;
    for (let s = 0; s < 3; s++) {
      const by = new Map<string, number>();
      const add = (k: string): void => { const id = this.id(k); if (id < 0) return; let a: string; try { a = reg.sprite(id).atlas.key; } catch { return; } if (!by.has(a)) by.set(a, id); };
      // every key the season can draw (bases, a full edge/shore sample, water/ice/leaves)
      for (const m of GROUND_PRIORITY) for (const v of GROUND_VARIANTS) add(`gt_${m}${v}${GROUND_SEASON_SUFFIX[s]}`);
      for (const m of GROUND_PRIORITY) for (let k = 1; k < 256; k++) if (blobReduce(k) === k) { add(`gt_${m}_edge_${k}${GROUND_SEASON_SUFFIX[s]}`); }
      for (let k = 1; k < 256; k++) if (blobReduce(k) === k) { add(`gt_shore_${k}${GROUND_SEASON_SUFFIX[s]}`); add(`gt_bank_${k}${GROUND_SEASON_SUFFIX[s]}`); }
      if (s === 2) for (const v of GROUND_VARIANTS) add(`gt_ice${v}`); else { add("gt_water"); add("gt_water_shallow"); }
      if (s === 1) for (const c of "abc") add(`gt_water_leaves_${c}`);
      this.pages[s] = [...by.values()];
    }
  }
  /** Sprite id for a layer key: exact, else without the season suffix, else winter ice -> gt_water_winter; -1 = none. */
  id(key: string): number {
    let v = this.ids.get(key); if (v !== undefined) return v;
    const t = (k: string): number => this.reg.ids.sprites.tryId(k) ?? -1;
    v = t(key);
    if (v < 0 && /_(fall|winter)$/.test(key)) v = t(key.replace(/_(fall|winter)$/, ""));
    if (v < 0 && key.startsWith("gt_ice")) v = t("gt_water_winter");
    this.ids.set(key, v); return v;
  }
  /** One sprite per atlas page the season draws from (stream keep-alive + readiness). */
  pageSprites(season: number): readonly number[] { return this.pages[season] ?? []; }
}
/** Is this layer drawn with the water tint (animated grey water art)? Ice, leaves and shores are not. */
export const tintedLayer = (k: GroundLayerKind): boolean => k === GroundLayerKind.Water;
