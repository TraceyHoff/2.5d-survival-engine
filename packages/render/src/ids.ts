/**
 * CANONICAL render-facing numeric ids (the engine's single source; /workspace/iso-renderer is deprecated).
 * Values are part of saved chunks / the wire (TileMap stores u16 tile ids), so they are append-only: never renumber.
 */

/**
 * Terrain tile ids stored in TileMap chunks (u16). 0 = empty / not generated.
 * Sprite keys (Art & Assets manifest `tiles` atlas) per id are in TERRAIN_SPRITES.
 */
export const TileId = {
  Empty: 0,
  Water: 1,
  Sand: 2,
  Grass: 3,
  Dirt: 4,   // also "forest floor": @engine/world DEFAULT_BANDS uses tile 4 for its forest band
  Stone: 5,  // art key tile_rock
  Snow: 6,
  Forest: 7, // dedicated forest floor (tile_forest); appended
  ShallowWater: 8, // tile_water_shallow; appended
  Mud: 9, // ADR-246: wet lowland ground (gt_mud*; tile_dirt fallback); appended
} as const;
export type TileId = (typeof TileId)[keyof typeof TileId];

/** Sprite.flags bits (u8). */
export const SpriteFlag = {
  FlipX: 1,       // mirror horizontally (not for baked-direction characters/buildings)
  Emissive: 2,    // whole sprite ignores darkness (feeds bloom)
  Sway: 4,        // legacy procedural sway when the sprite has no manifest `sway` block
  Flat: 8,        // ground decal: ground-plane depth instead of billboard depth
  NoOutline: 16,  // skip the shader outline
  BloomSource: 32,// set by the renderer for LightSource sprites (bloom mask only)
  Cutaway: 64,    // with Footprint only: open-roof interior, depth ignores sprite height (64 alone = night-only emissive on build pieces)
  Footprint: 128, // long-footprint billboard (vehicles): pixels below the pivot take ground-plane depth so near-side walls beat the terrain
} as const;
export type SpriteFlag = (typeof SpriteFlag)[keyof typeof SpriteFlag];

/** Terrain id -> art sprite keys (first = base; extra keys are random per-tile variants). */
export const TERRAIN_SPRITES: Readonly<Record<number, readonly string[]>> = {
  [TileId.Water]: ["tile_water"],
  [TileId.Sand]: ["tile_sand"],
  [TileId.Grass]: ["tile_grass", "tile_grass_b", "tile_grass_c"],
  [TileId.Dirt]: ["tile_dirt"],
  [TileId.Stone]: ["tile_rock"],
  [TileId.Snow]: ["tile_snow"],
  [TileId.Forest]: ["tile_forest"],
  [TileId.ShallowWater]: ["tile_water_shallow"],
  [TileId.Mud]: ["tile_dirt"], // ADR-246: no tile_mud art; the gt_ ground set has gt_mud*
};
/** Shore overlay sprite keys by the direction of the neighbouring water (n = -y, e = +x, s = +y, w = -x in tile axes). */
export const SHORE_SPRITES = { n: "tile_shore_n", e: "tile_shore_e", s: "tile_shore_s", w: "tile_shore_w", ne: "tile_shore_ne", se: "tile_shore_se", sw: "tile_shore_sw", nw: "tile_shore_nw" } as const;
export const isWaterTile = (id: number): boolean => id === TileId.Water || id === TileId.ShallowWater;
